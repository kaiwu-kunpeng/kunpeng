import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { runPatrol, type PatrolCurveDeps } from "../../src/loop/patrol.js";
import type { EvalDeps } from "../../src/evolution/eval-runner.js";
import type { RegressionTask } from "../../src/evolution/regression-store.js";
import type { ProposalEvidence, ProposedChange } from "../../src/loop/self-evolution.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-patrol-curve-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function seedExperience(store: ArtifactStore, id = "e1") {
  await store.write({
    kind: "experience",
    id,
    status: "draft",
    body: "",
    meta: { sourceFlow: `flow-${id}`, outcome: "verified", proposedRuleChange: { target: "conventions", text: `rule from ${id}` } },
  });
}

function task(id: string): RegressionTask {
  return {
    id,
    requirement: `requirement ${id}`,
    acceptanceCmd: `test ${id}`,
    sourceFlow: id,
    set: "holdout",
    createdAt: 12345,
  };
}

function proposalMeta(artifact: Awaited<ReturnType<ArtifactStore["read"]>>) {
  return artifact.meta as {
    proposal?: {
      changes?: ProposedChange[];
      evidence?: ProposalEvidence;
    };
  };
}

test("attaches real differential curve evidence from an injected candidate sandbox", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  await seedExperience(store);
  const holdout = [task("one"), task("two"), task("three")];
  const cleanup = vi.fn(async () => {});
  const prepareCandidate = vi.fn(async (_changes: ProposedChange[]) => ({
    candidateCwd: "/wt/cand",
    cleanup,
  }));
  const curveDeps: PatrolCurveDeps = {
    listHoldout: vi.fn(async () => holdout),
    runAcceptance: vi.fn(async (cmd: string, cwd: string) => {
      if (cwd === "/wt/base") return { passed: cmd === "test one", ms: 10 };
      if (cwd === "/wt/cand") return { passed: true, ms: 20 };
      throw new Error(`unexpected cwd: ${cwd}`);
    }),
    baselineCwd: "/wt/base",
    prepareCandidate,
  };
  const evalDeps: EvalDeps = {
    listHoldout: async () => {
      throw new Error("curveDeps must take priority over evalDeps");
    },
    runAcceptance: async () => {
      throw new Error("curveDeps must take priority over evalDeps");
    },
    cwd: dir,
    now: () => 999,
  };

  const result = await runPatrol({ store, curveDeps, evalDeps, now: () => 1000 });

  expect(result.evidenceAttached).toBe(true);
  expect(result.proposalId).toBeTruthy();
  expect(prepareCandidate).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledTimes(1);

  const proposal = await store.read(result.proposalId!);
  const meta = proposalMeta(proposal);
  const evidence = meta.proposal?.evidence;
  expect(proposal.status).toBe("draft");
  expect(evidence).toBeTruthy();
  expect(evidence?.holdoutPassK).toBeCloseTo(1);
  expect(evidence?.baseline?.holdoutPassK).toBeCloseTo(1 / 3);
  expect(evidence?.holdoutPassK ?? 0).toBeGreaterThan(evidence?.baseline?.holdoutPassK ?? 0);
  expect(evidence?.measuredAt).toBe(1000);
  expect(prepareCandidate).toHaveBeenCalledWith(meta.proposal?.changes);
});

test("keeps a draft proposal without evidence when candidate preparation fails", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  await seedExperience(store);
  const curveDeps: PatrolCurveDeps = {
    listHoldout: async () => [task("one")],
    runAcceptance: async () => ({ passed: true, ms: 1 }),
    baselineCwd: "/wt/base",
    prepareCandidate: vi.fn(async () => {
      throw new Error("cannot prepare candidate");
    }),
  };

  const result = await runPatrol({ store, curveDeps, now: () => 1000 });

  expect(result.proposalId).toBeTruthy();
  expect(result.evidenceAttached).toBe(false);
  const proposal = await store.read(result.proposalId!);
  expect(proposal.status).toBe("draft");
  expect(proposalMeta(proposal).proposal?.evidence).toBeUndefined();
});

test("preserves old evalDeps evidence behavior when curveDeps is not injected", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  await seedExperience(store);
  const evalDeps: EvalDeps = {
    listHoldout: async () => [task("one"), task("two")],
    runAcceptance: async (cmd: string) => ({ passed: cmd === "test one", ms: 30 }),
    cwd: dir,
    now: () => 456,
  };

  const result = await runPatrol({ store, evalDeps, now: () => 1000 });

  expect(result.evidenceAttached).toBe(true);
  expect(result.proposalId).toBeTruthy();
  const proposal = await store.read(result.proposalId!);
  const evidence = proposalMeta(proposal).proposal?.evidence;
  expect(proposal.status).toBe("draft");
  expect(evidence?.holdoutPassK).toBe(0.5);
  expect(evidence?.baseline?.holdoutPassK).toBe(0.5);
  expect(evidence?.baseline?.costPerResolvedTask).toBe(30);
  expect(evidence?.measuredAt).toBe(456);
});