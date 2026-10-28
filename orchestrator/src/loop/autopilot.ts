import type { FlowState, FlowTracker } from "../runtime/flowstate.js";
import { GUARDIAN_REINJECT_PREFIX } from "../feedback/finding-to-task.js";
import { classifySensitiveFiles, SENSITIVE_GATE_NOTE, summarizeSensitiveLabels, type SensitiveHit } from "../runtime/sensitive-paths.js";
import { formatMergeTierLine, type MergeTier, type MergeTierMode } from "../runtime/merge-tiers.js";
import { AUTOPILOT_OPTOUT_REASON_PREFIX, type AutopilotOptOut } from "./autopilot-optout.js";

export function pickCrashedResumes(
  flows: Pick<FlowState, "flowId" | "status" | "resumeAttempts">[],
  opts: { maxAttempts?: number; perCycle?: number } = {},
): string[] {
  const maxAttempts = opts.maxAttempts ?? 2;
  const perCycle = opts.perCycle ?? 2;
  return flows
    .filter((flow) => flow.status === "crashed" && (flow.resumeAttempts ?? 0) < maxAttempts)
    .slice(0, perCycle)
    .map((flow) => flow.flowId);
}

export function autoMergeVerdict(changedFiles: readonly string[]): { auto: boolean; reason?: string; hits: SensitiveHit[] } {
  const { hits } = classifySensitiveFiles(changedFiles);
  if (hits.length > 0) {
    return { auto: false, reason: `${SENSITIVE_GATE_NOTE}：${summarizeSensitiveLabels(hits)}`, hits };
  }
  return { auto: true, hits: [] };
}

function isGuardianErrorReinjectRequirement(requirement: string): boolean {
  return requirement.startsWith(GUARDIAN_REINJECT_PREFIX) && /（[^）]+\/error）/.test(requirement);
}

export interface AutopilotResult {
  merged: string[];
  skipped: { flowId: string; reason: string }[];
  rejected: { flowId: string; reason: string }[];
  optedOut?: { reason: string };
}

export interface AutopilotDeps {
  tracker: FlowTracker;
  optOut?: () => Promise<AutopilotOptOut>;
  merge: (
    flowId: string,
    base: string,
  ) => Promise<{ ok: boolean; error?: string; note?: string }>;
  futile?: (flowId: string, base: string) => Promise<{ futile: boolean; reason?: string }>;
  /** 敏感路径闸:按 base...kp/<flowId> 改动文件分类;命中即打标 sensitive + 保留人工门,autopilot 永不自动合并。 */
  sensitive?: (flowId: string, base: string) => Promise<{ hits: SensitiveHit[] }>;
  publicSurface?: (flowId: string, base: string) => Promise<{ touched: boolean; files?: string[] }>;
  discard?: (flowId: string) => Promise<void>;
  preReview?: (flowId: string) => Promise<{ verdict: string; reason: string } | null>;
  tier?: (flowId: string, base: string) => Promise<{ tier: MergeTier; reasons: string[]; ruleIds: string[]; mode: MergeTierMode }>;
  /** 一行日志出口(默认 console.log);敏感流被跳过时必打一行。 */
  log?: (line: string) => void;
}

export async function runAutopilot(
  deps: AutopilotDeps,
): Promise<AutopilotResult> {
  const flows = await deps.tracker.list();
  const candidates = flows.filter((flow) =>
    flow.status === "verified" &&
    flow.humanGate &&
    flow.humanGate.gate.includes("合并主干")
  );

  const merged: string[] = [];
  const skipped: { flowId: string; reason: string }[] = [];
  const rejected: { flowId: string; reason: string }[] = [];
  const log = deps.log ?? ((line: string) => console.log(line));
  if (deps.optOut) {
    let optOut: AutopilotOptOut;
    try {
      optOut = await deps.optOut();
    } catch (e) {
      optOut = {
        disabled: true,
        reason: AUTOPILOT_OPTOUT_REASON_PREFIX + "停用标记检测异常，保守按停用处理：" + String(e),
      };
    }
    if (optOut.disabled) {
      const { reason } = optOut;
      log(`[autopilot] 跳过 ${candidates.length} 条候选：${reason}`);
      return {
        merged: [],
        skipped: candidates.map(f => ({ flowId: f.flowId, reason })),
        rejected: [],
        optedOut: { reason },
      };
    }
  }
  const skipSensitive = (flowId: string, hits: SensitiveHit[]) => {
    const labels = summarizeSensitiveLabels(hits);
    log(`[autopilot] 敏感路径流 ${flowId} 跳过自动合并(${labels}),等人工合并门`);
    skipped.push({ flowId, reason: `${SENSITIVE_GATE_NOTE}：${labels}` });
  };

  if (!deps.sensitive) {
    log("[autopilot] 敏感路径闸未接线（deps.sensitive 缺失），只依赖流状态里已有的 sensitive 打标");
  }

  for (const flow of candidates) {
    // 已打标 sensitive 且门未清:不再跑任何闸,直接留门(候选过滤已保证 humanGate 存在)。
    if (flow.sensitive && flow.sensitive.hits.length > 0) {
      skipSensitive(flow.flowId, flow.sensitive.hits);
      continue;
    }

    if (isGuardianErrorReinjectRequirement(flow.requirement)) {
      skipped.push({
        flowId: flow.flowId,
        reason: "守护 error 回灌需人工审批",
      });
      continue;
    }

    const what = flow.humanGate?.what ?? "";
    const base = what.split("→")[1]?.trim() || "main";

    if (deps.futile && deps.discard) {
      let verdict: { futile: boolean; reason?: string };
      try {
        verdict = await deps.futile(flow.flowId, base);
      } catch (e) {
        skipped.push({
          flowId: flow.flowId,
          reason: "futile 检测异常，保守保留门：" + String(e),
        });
        continue;
      }
      if (verdict.futile) {
        await deps.discard(flow.flowId);
        rejected.push({
          flowId: flow.flowId,
          reason: verdict.reason ?? "过不去（空改动/分支缺失），已自动驳回",
        });
        continue;
      }
    }

    // 敏感路径闸放在 futile 之后:分支缺失/空改动先走自动驳回,不会因 git diff 报错而永远卡门。
    if (deps.sensitive) {
      let sensitive: { hits: SensitiveHit[] };
      try {
        sensitive = await deps.sensitive(flow.flowId, base);
      } catch (e) {
        skipped.push({
          flowId: flow.flowId,
          reason: "敏感路径检测异常，保守保留门：" + String(e),
        });
        continue;
      }
      if (sensitive.hits.length > 0) {
        await deps.tracker.markSensitive(flow.flowId, sensitive.hits);
        skipSensitive(flow.flowId, sensitive.hits);
        continue;
      }
    }

    if (deps.publicSurface) {
      let publicSurface: { touched: boolean; files?: string[] };
      try {
        publicSurface = await deps.publicSurface(flow.flowId, base);
      } catch (e) {
        skipped.push({
          flowId: flow.flowId,
          reason: "对外面检测异常，保守保留门：" + String(e),
        });
        continue;
      }
      if (publicSurface.touched) {
        skipped.push({
          flowId: flow.flowId,
          reason: `对外面改动需人工审批: ${(publicSurface.files ?? []).slice(0, 3).join(", ")}`,
        });
        continue;
      }
    }

    if (deps.preReview) {
      let preReview: { verdict: string; reason: string } | null;
      try {
        preReview = await deps.preReview(flow.flowId);
      } catch (e) {
        skipped.push({
          flowId: flow.flowId,
          reason: "合并预审异常，保守保留门：" + String(e),
        });
        continue;
      }
      if (preReview?.verdict === "reject") {
        skipped.push({
          flowId: flow.flowId,
          reason: "合并预审拒绝：" + preReview.reason,
        });
        continue;
      }
    }

    if (deps.tier) {
      let verdict: Awaited<ReturnType<NonNullable<AutopilotDeps["tier"]>>>;
      try {
        verdict = await deps.tier(flow.flowId, base);
      } catch (e) {
        skipped.push({
          flowId: flow.flowId,
          reason: "分级表计算异常，保守保留门：" + String(e),
        });
        continue;
      }
      if (typeof deps.tracker.setMergeTier === "function") {
        await deps.tracker.setMergeTier(flow.flowId, { ...verdict, at: Date.now() });
      }
      log(formatMergeTierLine(flow.flowId, verdict, verdict.mode));
      if (verdict.mode === "enforce" && verdict.tier === "human") {
        const reason = verdict.reasons.join("；");
        if (typeof deps.tracker.setGateHold === "function") {
          await deps.tracker.setGateHold(flow.flowId, { kind: "tier-human", reason, at: Date.now() });
        }
        skipped.push({ flowId: flow.flowId, reason: "分级表判需人审：" + reason });
        continue;
      }
    }

    const result = await deps.merge(flow.flowId, base);
    if (result.ok) {
      merged.push(flow.flowId);
    } else {
      skipped.push({
        flowId: flow.flowId,
        reason: result.error ?? "merge 未成功（可能被审查闸拦或冲突）",
      });
    }
  }

  return { merged, skipped, rejected };
}

export interface RepoAutopilotOutcome {
  repoPath: string;
  id?: string;
  name?: string;
  result?: AutopilotResult;
  error?: string;
}

export interface MultiRepoAutopilotDeps {
  repos: { repoPath: string; id?: string; name?: string }[];
  runOne: (repo: { repoPath: string; id?: string; name?: string }) => Promise<AutopilotResult>;
}

export interface MultiRepoAutopilotResult {
  outcomes: RepoAutopilotOutcome[];
  totalMerged: number;
  totalSkipped: number;
  totalRejected: number;
}

export async function runMultiRepoAutopilot(
  deps: MultiRepoAutopilotDeps,
): Promise<MultiRepoAutopilotResult> {
  const outcomes: RepoAutopilotOutcome[] = [];

  for (const repo of deps.repos) {
    try {
      const result = await deps.runOne(repo);
      outcomes.push({
        repoPath: repo.repoPath,
        id: repo.id,
        name: repo.name,
        result,
      });
    } catch (e) {
      outcomes.push({
        repoPath: repo.repoPath,
        id: repo.id,
        name: repo.name,
        error: String(e),
      });
    }
  }

  const totalMerged = outcomes.reduce((sum, outcome) => sum + (outcome.result?.merged.length ?? 0), 0);
  const totalSkipped = outcomes.reduce((sum, outcome) => sum + (outcome.result?.skipped.length ?? 0), 0);
  const totalRejected = outcomes.reduce((sum, outcome) => sum + (outcome.result?.rejected?.length ?? 0), 0);

  return { outcomes, totalMerged, totalSkipped, totalRejected };
}
