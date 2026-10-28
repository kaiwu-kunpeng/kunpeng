import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { CliRunner } from "../agent/cli-runner.js";
import { ArtifactStore } from "../artifacts/store.js";
import type { AutopilotDeps } from "../loop/autopilot.js";
import { readAutopilotOptOut } from "../loop/autopilot-optout.js";
import { matchesPublicSurface } from "../loop/public-surface.js";
import { classifyGateFutility } from "../runtime/gate-futility.js";
import { gateFutilityAdapter } from "../runtime/gate-git.js";
import { classifySensitiveFiles } from "../runtime/sensitive-paths.js";
import { aggregateRedFirstEvidence } from "../runtime/merge-tier-evidence.js";
import { decideMergeTier, resolveMergeTierMode } from "../runtime/merge-tiers.js";
import type { FlowTracker } from "../runtime/flowstate.js";
import { gateDiff } from "./gate-diff.js";
import { extractAcceptanceCriteria, loadProjectReviewRules, preReviewMerge } from "./pre-review.js";

const execFileAsync = promisify(execFile);

export const AUTOPILOT_GUARD_KEYS = ["optOut", "futile", "discard", "sensitive", "publicSurface", "preReview", "tier"] as const;

export function buildAutopilotGuards(
  repoRoot: string,
  tracker: FlowTracker,
): Required<Pick<AutopilotDeps, (typeof AUTOPILOT_GUARD_KEYS)[number]>> {
  const artifactStore = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));
  const listChangedFiles = async (base: string, flowId: string): Promise<string[]> => {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--no-renames", "--name-only", `${base}...kp/${flowId}`],
      { cwd: repoRoot, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
    );
    return String(stdout).split(/\r?\n/).filter((file) => file.length > 0);
  };
  const guards: Required<Pick<AutopilotDeps, (typeof AUTOPILOT_GUARD_KEYS)[number]>> = {
    optOut: () => readAutopilotOptOut(repoRoot),
    futile: (flowId, base) => classifyGateFutility(gateFutilityAdapter(repoRoot), flowId, base),
    discard: (flowId) => tracker.clearGate(flowId, { by: "machine", via: "autopilot-futile" }),
    sensitive: async (flowId, base) => {
      const changedFiles = await listChangedFiles(base, flowId);
      return { hits: classifySensitiveFiles(changedFiles).hits };
    },
    publicSurface: async (flowId, base) => {
      let raw: string;
      try {
        raw = await readFile(join(repoRoot, ".kunpeng", "public-surface.json"), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { touched: false };
        throw error;
      }

      let config: unknown;
      try {
        config = JSON.parse(raw) as unknown;
      } catch (error) {
        throw new Error(".kunpeng/public-surface.json 不是合法 JSON：" + String(error), { cause: error });
      }
      if (
        typeof config !== "object" || config === null ||
        !("patterns" in config) || !Array.isArray(config.patterns) ||
        !config.patterns.every((pattern) => typeof pattern === "string")
      ) {
        throw new Error(".kunpeng/public-surface.json 的 patterns 必须是 string[]");
      }

      const changedFiles = await listChangedFiles(base, flowId);
      const files = matchesPublicSurface(changedFiles, config.patterns);
      return { touched: files.length > 0, files };
    },
    preReview: async (flowId: string) => {
      const diffResult = await gateDiff(repoRoot, flowId);
      if (!diffResult.ok) throw new Error(diffResult.error ?? "无法读取合并 diff");
      let criteria: string | undefined;
      try {
        const spec = await artifactStore.read(flowId);
        if (spec.kind === "spec") {
          const testCmd = typeof spec.meta.testCmd === "string" ? spec.meta.testCmd : undefined;
          criteria = extractAcceptanceCriteria(spec.body, testCmd) || undefined;
        }
      } catch {
        criteria = undefined;
      }
      const runner = new CliRunner();
      const pr = await preReviewMerge(diffResult.diff, runner, Date.now, criteria, await loadProjectReviewRules(repoRoot));
      await tracker.setGatePreReview(flowId, pr);
      return pr;
    },
    tier: async (flowId, base) => {
      const changedFiles = await listChangedFiles(base, flowId);
      const sensitiveHits = classifySensitiveFiles(changedFiles).hits;
      let publicSurfaceTouched: boolean;
      try {
        publicSurfaceTouched = (await guards.publicSurface(flowId, base)).touched;
      } catch {
        // 对外面判不定按触及处理（fail-closed）
        publicSurfaceTouched = true;
      }
      const flow = await tracker.read(flowId);
      // plan 壳流自己没有验收证据,先红/基线绿要看它分解出的子流。
      const children = flow?.acceptEvidence?.baseline
        ? []
        : (await tracker.list()).filter((child) => child.planId === flowId && child.flowId !== flowId);
      const evidence = aggregateRedFirstEvidence(flow, children);
      const mode = resolveMergeTierMode(process.env);
      return {
        ...decideMergeTier({
          flowId,
          changedFiles,
          sensitiveHits,
          publicSurfaceTouched,
          preReviewVerdict: flow?.humanGate?.preReview?.verdict,
          ...evidence,
          changedFileCount: flow?.changedFileCount,
          guardStatus: "pending",
        }),
        mode,
      };
    },
  };
  return guards;
}
