import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FlowState } from "../runtime/flowstate.js";
import { failureSignature } from "./failure-signature.js";

export interface RecurringRollback {
  kind: string;
  signature: string;
  count: number;
  flowIds: string[];
  sample: string;
  lastAt: number;
}

export function collectRecurringRollbacks(
  flows: readonly FlowState[],
  opts: { sinceMs: number; minCount?: number },
): RecurringRollback[] {
  const groups = new Map<string, RecurringRollback & { sampleFlowId: string }>();
  for (const flow of flows) {
    const rollback = flow.rollback;
    if (
      flow.status !== "rolled-back" ||
      typeof rollback?.kind !== "string" || rollback.kind === "" ||
      !(flow.updatedAt >= opts.sinceMs) || !(flow.updatedAt >= flow.startedAt)
    ) continue;

    const { kind } = rollback;
    const sample = rollback.summary ?? "";
    const signature = failureSignature(sample).replace(/\d+/g, "<n>");
    const key = `${kind}|${signature}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        kind, signature, count: 1, flowIds: [flow.flowId], sample,
        lastAt: flow.updatedAt, sampleFlowId: flow.flowId,
      });
      continue;
    }
    group.count += 1;
    group.flowIds.push(flow.flowId);
    if (
      flow.updatedAt > group.lastAt ||
      (flow.updatedAt === group.lastAt && flow.flowId.localeCompare(group.sampleFlowId) < 0)
    ) {
      group.lastAt = flow.updatedAt;
      group.sample = sample;
      group.sampleFlowId = flow.flowId;
    }
  }

  return [...groups.values()]
    .filter((group) => group.count >= (opts.minCount ?? 3))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt ||
      a.kind.localeCompare(b.kind) || a.signature.localeCompare(b.signature))
    .map(({ sampleFlowId: _sampleFlowId, ...group }) => ({
      ...group,
      flowIds: group.flowIds.sort((a, b) => a.localeCompare(b)),
    }));
}

export const RECURRENCE_HINTS: Readonly<Record<string, string>> = {
  "transform-error": "锁定块末尾留空行、块内勿含三反引号，先本地 tsc/vitest 跑通再派",
  typecheck: "spec 给死函数签名与导出名；新增字段同步改类型与调用方",
  "test-failed": "先在 main 上跑作者测试确认红在该红处，再核对夹具与断言取值",
  lint: "新文件按既有 ESM/.js 后缀/无 any 风格写，派前跑一次 eslint",
  "check-regression": "改动面收窄到 scope 内，别顺手动基线之外的文件",
  timeout: "验收命令塞进单步预算，长任务边做边落盘、第 7 分钟收口",
  "empty-diff": "验收必须依赖本流新改动，先红后绿，别让空 commit 也能过",
  "no-accept-cmd": "spec 必带 accept 块，且是作者亲写的具体测试命令",
  "anchor-missing": "grep 锚点/测试文件路径用绝对或 cd 后的正确相对路径",
  unknown: "把 accept 真实输出贴进 spec 再派，别靠猜归因",
  "scope-gate": "scope 用单行 allow: <glob>，实现只碰 allow 内文件",
  "not-red-first": "派前在 scratch worktree 确认作者测试在 main 上必红",
  "worktree-contention": "同一流别并行重发；发射前先 git worktree prune",
  "audit-rejected": "vitest 点名的测试文件必须以作者块锁进 spec",
  crashed: "查 serve 重启/租约过期，别重派同 id",
  abandoned: "人工放弃；重派前先改 spec 再起新 id",
};

export function hintFor(kind: string): string {
  const hint = RECURRENCE_HINTS[kind] ?? RECURRENCE_HINTS.unknown;
  return typeof hint === "string" ? hint : RECURRENCE_HINTS.unknown;
}

export interface SpecLintRecurrenceRule {
  code: string;
  kind: string;
  count: number;
  sample: string;
  hint: string;
  flowIds: string[];
}

export interface SpecLintRuleFile {
  generatedAt: number;
  sinceDays: number;
  rules: SpecLintRecurrenceRule[];
}

export function buildRecurrenceRules(
  clusters: readonly RecurringRollback[],
  opts: { now: number; sinceDays: number },
): SpecLintRuleFile {
  const groups = new Map<string, { rule: SpecLintRecurrenceRule; sampleCount: number }>();
  for (const cluster of clusters) {
    const group = groups.get(cluster.kind);
    if (!group) {
      groups.set(cluster.kind, {
        rule: {
          code: `recurring-rollback:${cluster.kind}`,
          kind: cluster.kind,
          count: cluster.count,
          sample: cluster.sample,
          hint: hintFor(cluster.kind),
          flowIds: [...new Set(cluster.flowIds)].slice(0, 5),
        },
        sampleCount: cluster.count,
      });
      continue;
    }
    group.rule.count += cluster.count;
    group.rule.flowIds = [...new Set([...group.rule.flowIds, ...cluster.flowIds])].slice(0, 5);
    if (cluster.count > group.sampleCount) {
      group.rule.sample = cluster.sample;
      group.sampleCount = cluster.count;
    }
  }
  return {
    generatedAt: opts.now,
    sinceDays: opts.sinceDays,
    rules: [...groups.values()].map(({ rule }) => rule)
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
  };
}

export function recurrenceRulesPath(kunpengDir: string): string {
  return join(kunpengDir, "spec-lint-rules.json");
}

export function loadRecurrenceRules(kunpengDir: string): SpecLintRecurrenceRule[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(recurrenceRulesPath(kunpengDir), "utf8"));
    if (
      raw === null || typeof raw !== "object" || Array.isArray(raw) ||
      !("rules" in raw) || !Array.isArray(raw.rules)
    ) return [];

    const rules: SpecLintRecurrenceRule[] = [];
    for (const value of raw.rules as unknown[]) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
      const { code, kind, count, sample, hint, flowIds } = value as Record<string, unknown>;
      if (
        typeof code !== "string" || typeof kind !== "string" ||
        typeof sample !== "string" || typeof hint !== "string" ||
        typeof count !== "number" || !Number.isFinite(count)
      ) continue;
      rules.push({
        code, kind, count, sample, hint,
        flowIds: Array.isArray(flowIds) && flowIds.every((id) => typeof id === "string") ? flowIds : [],
      });
    }
    return rules;
  } catch {
    // 复发提示是可选数据；缺失、损坏或不可读时不阻断 spec 校验。
    return [];
  }
}

export async function writeRecurrenceRules(
  kunpengDir: string,
  flows: readonly FlowState[],
  opts: { now: number; sinceDays: number; minCount?: number },
): Promise<{ path: string; file: SpecLintRuleFile }> {
  const sinceMs = opts.now - opts.sinceDays * 86_400_000;
  const clusters = collectRecurringRollbacks(flows, { sinceMs, minCount: opts.minCount });
  const file = buildRecurrenceRules(clusters, opts);
  const path = recurrenceRulesPath(kunpengDir);
  await mkdir(kunpengDir, { recursive: true });
  await writeFile(path, JSON.stringify(file, null, 2) + "\n", "utf8");
  return { path, file };
}
