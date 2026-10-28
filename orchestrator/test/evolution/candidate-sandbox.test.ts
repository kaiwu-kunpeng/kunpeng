import { expect, test, vi } from "vitest";
import { buildCandidateSandbox, type CandidateSandboxConfig } from "../../src/evolution/candidate-sandbox.js";
import type { ProposedChange } from "../../src/loop/self-evolution.js";

test("prepares a candidate worktree and applies convention changes through injected deps", async () => {
  const changes: ProposedChange[] = [
    { target: "conventions", text: "规则X", source: "exp-1" },
  ];
  const acquire = vi.fn(async (_flowId: string, _base?: string) => ({ path: "/wt/cand-1" }));
  const applyChanges = vi.fn(async (_conventionsPath: string, _changes: ProposedChange[]) => ({
    appended: ["规则X"],
    skipped: [],
  }));
  const cleanup = vi.fn(async (_flowId: string) => {});
  const config: CandidateSandboxConfig = {
    acquire,
    cleanup,
    applyChanges,
    conventionsRelPath: ".kunpeng/constitution/conventions.md",
    base: "main",
    newFlowId: () => "eval-cand-1",
  };

  const prepareCandidate = buildCandidateSandbox(config);
  const candidate = await prepareCandidate(changes);

  expect(candidate.candidateCwd).toBe("/wt/cand-1");
  expect(candidate.appliedChanges).toEqual(["规则X"]);
  expect(applyChanges).toHaveBeenCalledWith(
    "/wt/cand-1/.kunpeng/constitution/conventions.md",
    changes,
  );
  expect(acquire).toHaveBeenCalledWith("eval-cand-1", "main");

  await candidate.cleanup();

  expect(cleanup).toHaveBeenCalledWith("eval-cand-1");
});

test("cleans up the candidate worktree before rethrowing apply failures", async () => {
  const changes: ProposedChange[] = [
    { target: "conventions", text: "规则X", source: "exp-1" },
  ];
  const error = new Error("apply failed");
  const cleanup = vi.fn(async (_flowId: string) => {});
  const config: CandidateSandboxConfig = {
    acquire: vi.fn(async () => ({ path: "/wt/cand-1" })),
    cleanup,
    applyChanges: vi.fn(async () => {
      throw error;
    }),
    conventionsRelPath: ".kunpeng/constitution/conventions.md",
    base: "main",
    newFlowId: () => "eval-cand-1",
  };

  const prepareCandidate = buildCandidateSandbox(config);

  await expect(prepareCandidate(changes)).rejects.toThrow(error);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledWith("eval-cand-1");
});
