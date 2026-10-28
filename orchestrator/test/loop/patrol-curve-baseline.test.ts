import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { runPatrol, type PatrolCurveDeps } from "../../src/loop/patrol.js";
import type { RegressionTask } from "../../src/evolution/regression-store.js";
import type { ProposalEvidence } from "../../src/loop/self-evolution.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-patrol-curve-baseline-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

async function seedExperience(store: ArtifactStore): Promise<void> {
  await store.write({
    kind: "experience",
    id: "e1",
    status: "draft",
    body: "",
    meta: { sourceFlow: "flow-e1", outcome: "verified", proposedRuleChange: { target: "conventions", text: "rule from e1" } },
  });
}
function task(id: string): RegressionTask {
  return { id, requirement: `requirement ${id}`, acceptanceCmd: `test ${id}`, sourceFlow: id, set: "holdout", createdAt: 12345 };
}
function evidenceOf(artifact: Awaited<ReturnType<ArtifactStore["read"]>>): ProposalEvidence | undefined {
  return (artifact.meta as { proposal?: { evidence?: ProposalEvidence } }).proposal?.evidence;
}

test("基线 cwd 取 prepareCandidate 返回的工作树；不再需要静态 baselineCwd", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  await seedExperience(store);
  const seen = new Set<string>();
  const curveDeps: PatrolCurveDeps = {
    listHoldout: async () => [task("one"), task("two")],
    runAcceptance: vi.fn(async (cmd: string, cwd: string) => {
      seen.add(cwd);
      if (cwd === "/wt/base-dyn") return { passed: cmd === "test one", ms: 10 };
      if (cwd === "/wt/cand") return { passed: true, ms: 20 };
      throw new Error(`unexpected cwd: ${cwd}`);
    }),
    prepareCandidate: vi.fn(async () => ({ candidateCwd: "/wt/cand", baselineCwd: "/wt/base-dyn", cleanup: async () => {} })),
  };

  const result = await runPatrol({ store, curveDeps, now: () => 1000 });

  expect(result.evidenceAttached).toBe(true);
  expect([...seen].sort()).toEqual(["/wt/base-dyn", "/wt/cand"]);
  const evidence = evidenceOf(await store.read(result.proposalId!));
  expect(evidence?.baseline?.holdoutPassK).toBeCloseTo(0.5);
  expect(evidence?.holdoutPassK).toBeCloseTo(1);
});

test("动态与静态基线都没有 → 一条验收都不跑，提案保持无证据 draft，cleanup 照常", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  await seedExperience(store);
  const cleanup = vi.fn(async () => {});
  const runAcceptance = vi.fn(async () => ({ passed: true, ms: 1 }));
  const curveDeps: PatrolCurveDeps = {
    listHoldout: async () => [task("one")],
    runAcceptance,
    prepareCandidate: vi.fn(async () => ({ candidateCwd: "/wt/cand", cleanup })),
  };

  const result = await runPatrol({ store, curveDeps, now: () => 1000 });

  expect(result.proposalId).toBeTruthy();
  expect(result.evidenceAttached).toBe(false);
  expect(runAcceptance).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(evidenceOf(await store.read(result.proposalId!))).toBeUndefined();
});