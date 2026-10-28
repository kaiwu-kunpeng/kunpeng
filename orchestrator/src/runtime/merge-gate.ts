import { randomBytes } from "node:crypto";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { join } from "node:path";
import { gitWithWallClock } from "../git/git-wall.js";
import { safeMerge } from "../git/merge.js";
import { freshenBranchOntoMain } from "../git/refresh-branch.js";
import { appendChangelogOnBranch } from "../git/changelog-on-branch.js";
import { changelogEntryFromRequirement } from "../dossier/changelog.js";
import { enqueueOutbox } from "../loop/outbox.js";
import { kunpengStateDir } from "../project/registry.js";
import { checkStopSignal } from "../switchboard/checkpoint.js";
import { resolveIdentity } from "../switchboard/identity.js";
import { SwitchboardStore } from "../switchboard/store.js";
import { FlowTracker, type GateClearRecord } from "./flowstate.js";
import { withFileLock } from "./filelock.js";
import { recordControlPlaneChanges } from "./control-plane-audit.js";
import { findStaleDeletions } from "./merge-deletion-guard.js";
import { defaultMergeReview, type MergeReviewContext } from "./merge-review.js";
import { runPreMergeHooks } from "./hooks.js";
import { resolveGuardTestFilters, runGuardTests, type GuardTestResult } from "./merge-guard-tests.js";
import { sensitiveHitsForBranch } from "./sensitive-branch.js";
import { SENSITIVE_GATE_NOTE, summarizeSensitiveLabels, type SensitiveHit } from "./sensitive-paths.js";

export interface MergeGateResult { ok: boolean; error?: string; note?: string; guard?: GuardTestResult }
export type GuardTestRunner = (ctx: { repoRoot: string; flowId: string; base: string }) => Promise<GuardTestResult>;
export type MergeReview = (ctx: MergeReviewContext) => Promise<{ block: boolean; findings?: string[] }>;
export type MergeStopCheckpoint = (ctx: {
  repoRoot: string;
  flowId: string;
  base: string;
}) => Promise<{ halt: boolean; acked: string[] }>;

export interface MergeGateOptions {
  guardTests?: GuardTestRunner | false;
  clearedBy?: GateClearRecord;
  review?: MergeReview;
  onCheckpoint?: () => Promise<boolean>;
  stopCheckpoint?: MergeStopCheckpoint | false;
  allowSensitive?: boolean;
  sensitiveCheck?: (ctx: { repoRoot: string; flowId: string; base: string }) => Promise<SensitiveHit[]>;
}

export async function pushWithTimeout<T>(push: () => Promise<T>, timeoutMs?: number): Promise<T> {
  const configuredMs = timeoutMs ?? Number(process.env.KUNPENG_MERGE_PUSH_TIMEOUT_MS);
  const ms = Number.isInteger(configuredMs) && configuredMs > 0 ? configuredMs : 30_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
  };
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      clearTimer();
      reject(new Error(`push 超时(${ms}ms),已放弃等待`));
    }, ms);
  });
  const pushing = Promise.resolve().then(push).finally(clearTimer);
  try {
    return await Promise.race([pushing, timeout]);
  } finally {
    clearTimer();
  }
}

async function diffForReview(repoRoot: string, flowId: string, base: string): Promise<string> {
  return gitWithWallClock(repoRoot).raw(["diff", `${base}...kp/${flowId}`]);
}

async function defaultStopCheckpoint(ctx: { repoRoot: string; flowId: string; base: string }): Promise<{ halt: boolean; acked: string[] }> {
  const store = new SwitchboardStore(join(kunpengStateDir(), "switchboard"));
  const me = resolveIdentity({ env: process.env.KUNPENG_INSTANCE, cwd: ctx.repoRoot });
  return checkStopSignal(store, me, {
    now: Date.now,
    id: () => `rcpt-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
  });
}

/** 安全合并 kp/<flowId> -> base，成功后清掉该 flow 的 humanGate。
 *  合并失败绝不清门，保留人工门提示冲突/失败需要处理。
 *  并发保障：用 repo 级合并锁串行化——并行多 agent 同时向 main 合并不会互相踩 git index/HEAD，
 *  谁先谁后都对（后到者拿锁时 main 可能已前进，safeMerge 仍走 3-way，冲突则安全中止、绝不清门）。 */
export async function mergeAndClearGate(repoRoot: string, flowId: string, base = "main", opts: MergeGateOptions = {}): Promise<MergeGateResult> {
  if (!flowId.trim()) return { ok: false, error: "flowId 不能为空" };
  const lockDir = join(repoRoot, ".kunpeng", "locks", "merge.lock");
  try {
    const tracker = new FlowTracker(resolveProjectStateDir(repoRoot));
    const startedAt = Date.now();
    let guard: GuardTestResult;
    try {
      const runner = opts.guardTests ?? ((ctx) => runGuardTests({ ...ctx, filters: resolveGuardTestFilters(process.env) }));
      guard = runner === false
        ? { status: "skipped", summary: "守门测试已关闭（guardTests=false）", durationMs: 0 }
        : await runner({ repoRoot, flowId, base });
    } catch (error) {
      guard = { status: "red", summary: String(error), durationMs: Date.now() - startedAt };
    }
    if (guard.status === "red") {
      await tracker.setGateHold(flowId, { kind: "guard-red", reason: guard.summary, at: Date.now() });
      return { ok: false, error: `守门测试碰红：${guard.summary.slice(0, 300)}（保留人工门）`, guard };
    }
    return await withFileLock(lockDir, async () => {
      const cpChanges = recordControlPlaneChanges(repoRoot);
      if (cpChanges.length > 0) {
        console.warn(`[merge-gate] 控制面变更 ${cpChanges.length} 条已记审计行: ${cpChanges.map((c) => c.file).join(", ")}`);
      }
      if (opts.onCheckpoint) {
        let halt: boolean;
        try {
          halt = await opts.onCheckpoint();
        } catch (e) {
          await tracker.setGateHold(flowId, { kind: "stop-signal", reason: `合并前停止信号检查失败：${String(e)}（保留人工门）`, at: Date.now() });
          return { ok: false, error: `合并前停止信号检查失败：${String(e)}（保留人工门）` };
        }
        if (halt) {
          await tracker.setGateHold(flowId, { kind: "stop-signal", reason: "合并前收到停止信号，拒绝合并、保留人工门", at: Date.now() });
          return { ok: false, error: "合并前收到停止信号，拒绝合并、保留人工门" };
        }
      }
      const checkpoint = opts.stopCheckpoint === false ? undefined : (opts.stopCheckpoint ?? defaultStopCheckpoint);
      if (checkpoint) {
        let stop: { halt: boolean; acked: string[] };
        try {
          stop = await checkpoint({ repoRoot, flowId, base });
        } catch (e) {
          await tracker.setGateHold(flowId, { kind: "stop-signal", reason: `合并前停止信号检查失败：${String(e)}（保留人工门）`, at: Date.now() });
          return { ok: false, error: `合并前停止信号检查失败：${String(e)}（保留人工门）` };
        }
        if (stop.halt) {
          await tracker.setGateHold(flowId, { kind: "stop-signal", reason: `合并前收到停止信号（已回执 ${stop.acked.length} 条），拒绝合并、保留人工门`, at: Date.now() });
          return { ok: false, error: `合并前收到停止信号（已回执 ${stop.acked.length} 条），拒绝合并、保留人工门` };
        }
      }
      // 敏感停车场（C5#1 下沉）：默认路径一律自查，任何自动调用方漏掉也兜得住。
      if (opts.allowSensitive !== true) {
        const sensitiveCheck = opts.sensitiveCheck
          ?? ((ctx: { repoRoot: string; flowId: string; base: string }) => sensitiveHitsForBranch(ctx.repoRoot, ctx.flowId, ctx.base));
        let hits: SensitiveHit[];
        try {
          hits = await sensitiveCheck({ repoRoot, flowId, base });
        } catch (e) {
          // fail-closed：判不定一律判失败，不合并、保留人工门。
          const reason = `${SENSITIVE_GATE_NOTE}：敏感判定失败（${String(e)}），判不定即拒合、保留人工门`;
          await tracker.setGateHold(flowId, { kind: "sensitive-park", reason, at: Date.now() });
          return { ok: false, error: reason };
        }
        if (hits.length > 0) {
          const reason = `${SENSITIVE_GATE_NOTE}：${summarizeSensitiveLabels(hits)}（自动路径已停车，须真人合并或显式 --allow-sensitive）`;
          await tracker.markSensitive(flowId, hits);
          await tracker.setGateHold(flowId, { kind: "sensitive-park", reason, at: Date.now() });
          return { ok: false, error: reason };
        }
      }
      const reviewGate = opts.review ?? defaultMergeReview;
      const diff = await diffForReview(repoRoot, flowId, base);
      // 预审发现随门状态进确定性审查（P1-6）：normal 桶带 file:line+证据即拦，不再只靠 verdict 一个字。
      const gateFlow = await tracker.read(flowId).catch(() => null);
      const review = await reviewGate({ repoRoot, flowId, base, diff, preReview: gateFlow?.humanGate?.preReview });
      if (review.block) {
        await tracker.setGateHold(flowId, { kind: "review-block", reason: (review.findings ?? []).join("；"), at: Date.now() });
        return { ok: false, error: `合并前审查未通过：${(review.findings ?? []).join("；")}` };
      }
      // 用户可配 PreMerge 钩子（.kunpeng/hooks.json 的 preMerge 命令）：任一非零退出拒合、保门。无配置=放行。
      const hookOutcome = await runPreMergeHooks(repoRoot);
      if (!hookOutcome.ok) {
        await tracker.setGateHold(flowId, { kind: "hook-failed", reason: `preMerge 钩子未通过：${hookOutcome.failures.map((f) => f.command).join("；")}（保留人工门）`, at: Date.now() });
        return { ok: false, error: `preMerge 钩子未通过：${hookOutcome.failures.map((f) => f.command).join("；")}（保留人工门）` };
      }
      // 合并前刷新闸（C10 机制层兜底）：在合并锁内、先把当前 base 合进流分支，使 base 成为其祖先——
      // 杜绝陈旧 worktree 基底 + add -A 整树提交导致「合并覆盖 base 上的并发改动」（曾两次误删/覆盖 flywheel.ts、cli.ts）。
      // 冲突/异常一律 fail-closed：不合并、不清门，提示重跑该流。
      const fresh = await freshenBranchOntoMain(repoRoot, "kp/" + flowId, base);
      if (fresh.status === "conflict") {
        await tracker.setGateHold(flowId, { kind: "refresh-conflict", reason: `刷新闸：流分支与 ${base} 冲突（基底陈旧），拒绝合并、保留人工门——请重跑该流`, at: Date.now() });
        return { ok: false, error: `刷新闸：流分支与 ${base} 冲突（基底陈旧），拒绝合并、保留人工门——请重跑该流` };
      }
      if (fresh.status === "error") {
        await tracker.setGateHold(flowId, { kind: "refresh-conflict", reason: `刷新闸异常：${fresh.error ?? "未知"}（保留人工门）`, at: Date.now() });
        return { ok: false, error: `刷新闸异常：${fresh.error ?? "未知"}（保留人工门）` };
      }
      const flow = await tracker.read(flowId).catch(() => null);
      const item = changelogEntryFromRequirement(flow?.requirement ?? "", flowId);
      let changelogNote = "";
      if (item) {
        const changelog = await appendChangelogOnBranch(repoRoot, "kp/" + flowId, item);
        if (changelog.status === "appended" || changelog.status === "already-present") {
          changelogNote = "；CHANGELOG 已追加";
        } else if (changelog.status === "error") {
          const error = [...(changelog.error ?? "未知错误")].slice(0, 200).join("").replace(/[\r\n]+/g, " ");
          console.warn(`[merge-gate] CHANGELOG 未追加 flow=${flowId}：${error}`);
          changelogNote = `；⚠ CHANGELOG 未追加：${error}`;
        }
      }
      const git = gitWithWallClock(repoRoot);
      const beforeSha = (await git.raw(["rev-parse", base])).trim();
      const r = await safeMerge(repoRoot, base, "kp/" + flowId);
      if (!r.ok) return { ok: false, error: r.error };
      const afterSha = (await git.raw(["rev-parse", base])).trim();
      const stale = await findStaleDeletions({
        diffNames: async (args) => (await git.raw(["diff", ...args])).split("\n").filter(Boolean),
        mergeBase: async (a, b) => (await git.raw(["merge-base", a, b])).trim(),
      }, beforeSha, afterSha, "kp/" + flowId).catch(() => []);
      if (stale.length > 0) {
        await tracker.setGateHold(flowId, { kind: "stale-deletion", reason: `合并后检测到静默误删（未清人工门）：${stale.join("、")}`, at: Date.now() });
        return { ok: false, error: `合并后检测到静默误删（未清人工门）：${stale.join("、")}` };
      }
      await tracker.clearGate(flowId, opts.clearedBy ?? { by: "unknown", via: "merge-gate" });
      const cleared: GateClearRecord = opts.clearedBy ?? { by: "unknown", via: "merge-gate" };
      await tracker.mutate(flowId, (s) => {
        s.mergedBy = { by: cleared.by, via: cleared.via, at: Date.now(), sha: afterSha };
      });
      let note = `已安全合并 kp/${flowId} → ${base} 并清除人工门`;
      const remotes = await git.getRemotes();
      if (remotes.some((remote) => remote.name === "origin")) {
        try {
          await pushWithTimeout(() => git.push("origin", base));
          note += "；已推送 origin/" + base;
        } catch (e) {
          console.error("[merge-gate] push 失败 flow=" + flowId + ": " + String(e));
          try {
            enqueueOutbox(repoRoot, "ops", {
              urls: ["git-push://origin/" + encodeURIComponent(base) + "?flow=" + encodeURIComponent(flowId)],
              host: "origin",
              keyLocation: base,
            });
          } catch (outboxError) {
            console.error("[merge-gate] push 失败告警入队失败 flow=" + flowId + ": " + String(outboxError));
          }
          note += "；⚠ push origin/" + base + " 失败";
        }
      }
      return { ok: true, note: note + changelogNote, guard };
    });
  } catch (e) {
    return { ok: false, error: `合并锁异常：${String(e)}` };
  }
}

/** CLI `kunpeng merge <flowId> [base] [--allow-sensitive]` 的纯接线：解析 rest、校验、委派。 */
export async function runMergeCommand(rest: string[], repoRoot: string, opts: MergeGateOptions = {}): Promise<MergeGateResult> {
  const allowSensitive = rest.includes("--allow-sensitive");
  const args = rest.filter((arg) => arg !== "--allow-sensitive");
  const flowId = args[0] ?? "";
  const base = args[1] || "main";
  if (!flowId.trim()) return { ok: false, error: "用法: kunpeng merge <flowId> [base] [--allow-sensitive]" };
  return mergeAndClearGate(repoRoot, flowId, base, allowSensitive ? { ...opts, allowSensitive: true } : opts);
}
