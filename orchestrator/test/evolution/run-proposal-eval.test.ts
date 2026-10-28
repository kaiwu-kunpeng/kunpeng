import { describe, expect, test, vi } from "vitest";
import type { ArtifactStore } from "../../src/artifacts/store.js";
import type { Artifact } from "../../src/artifacts/types.js";
import type { AgentAttempt } from "../../src/evolution/agent-differential.js";
import { evaluateProposal, type ProposalEvalDeps } from "../../src/evolution/run-proposal-eval.js";
import type { RegressionTask } from "../../src/evolution/regression-store.js";
import type { ProposedChange } from "../../src/loop/self-evolution.js";

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

function memoryStore(initial: Artifact[]): ArtifactStore {
  const artifacts = new Map(initial.map((artifact) => [artifact.id, artifact]));
  return {
    read: vi.fn(async (id: string) => {
      const artifact = artifacts.get(id);
      if (!artifact) throw new Error(`missing artifact: ${id}`);
      return artifact;
    }),
    write: vi.fn(async (artifact: Artifact) => {
      artifacts.set(artifact.id, artifact);
      return artifact;
    }),
  } as unknown as ArtifactStore;
}

function proposal(id: string, changes: ProposedChange[]): Artifact {
  return {
    kind: "proposal",
    id,
    status: "draft",
    body: "proposal body",
    meta: { proposal: { changes } },
  };
}

function baseDeps(overrides: Partial<ProposalEvalDeps> = {}): ProposalEvalDeps {
  const changes: ProposedChange[] = [{ target: "conventions", text: "add rule", source: "exp-1" }];
  const tasks = [task("one"), task("two"), task("three")];
  const cleanup = vi.fn(async () => {});

  return {
    store: memoryStore([proposal("p1", changes)]),
    loadProposalChanges: vi.fn(async () => changes),
    listHoldout: vi.fn(async () => tasks),
    baselineRules: "base",
    candidateRulesFor: vi.fn(() => "base+rule"),
    prepareWorktrees: vi.fn(async () => ({
      baselineCwd: "/wt/b",
      candidateCwd: "/wt/c",
      cleanup,
    })),
    runAttempt: vi.fn(async (regressionTask: RegressionTask, rules: string): Promise<AgentAttempt> => {
      if (rules === "base+rule") return { passed: true, ms: 30 };
      return { passed: regressionTask.id === "one", ms: 10 };
    }),
    now: () => 999,
    ...overrides,
  };
}

describe("evaluateProposal", () => {
  test("runs holdout differential and attaches evidence to the draft proposal", async () => {
    const deps = baseDeps();

    const result = await evaluateProposal("p1", deps);

    expect(result).not.toBeNull();
    expect(result?.evidence.holdoutPassK).toBeCloseTo(1);
    expect(result?.evidence.baseline?.holdoutPassK).toBeCloseTo(1 / 3);
    expect(result?.report).toMatchObject({ improved: true, taskCount: 3 });
    expect(deps.loadProposalChanges).toHaveBeenCalledWith("p1");
    expect(deps.listHoldout).toHaveBeenCalledTimes(1);
    expect(deps.prepareWorktrees).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
    expect(deps.candidateRulesFor).toHaveBeenCalledWith([
      { target: "conventions", text: "add rule", source: "exp-1" },
    ]);
    expect(deps.runAttempt).toHaveBeenCalledTimes(2 * 3);

    const updated = await deps.store.read("p1");
    const meta = updated.meta as {
      proposal?: {
        evidence?: {
          holdoutPassK?: number;
          baseline?: { holdoutPassK?: number };
        };
      };
    };
    expect(meta.proposal?.evidence).toEqual(result?.evidence);
    expect(updated.status).toBe("draft");

    const prepared = await vi.mocked(deps.prepareWorktrees).mock.results[0].value;
    expect(prepared.cleanup).toHaveBeenCalledTimes(1);
  });

  test("returns null for a missing proposal without preparing worktrees", async () => {
    const prepareWorktrees = vi.fn();
    const deps = baseDeps({
      loadProposalChanges: vi.fn(async () => null),
      prepareWorktrees,
    });

    await expect(evaluateProposal("p1", deps)).resolves.toBeNull();
    expect(prepareWorktrees).not.toHaveBeenCalled();
  });

  test("rethrows differential failures and still cleans up worktrees", async () => {
    const cleanup = vi.fn(async () => {});
    const error = new Error("agent failed");
    const deps = baseDeps({
      prepareWorktrees: vi.fn(async () => ({
        baselineCwd: "/wt/b",
        candidateCwd: "/wt/c",
        cleanup,
      })),
      runAttempt: vi.fn(async () => {
        throw error;
      }),
    });

    await expect(evaluateProposal("p1", deps)).rejects.toBe(error);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
