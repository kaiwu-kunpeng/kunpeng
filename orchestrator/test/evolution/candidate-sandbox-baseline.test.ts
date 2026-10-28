import { expect, test, vi } from "vitest";
import { buildCandidateSandbox } from "../../src/evolution/candidate-sandbox.js";

test("给了 baselineFlowId 就先开基线工作树再开候选；cleanup 先候选后基线", async () => {
  const calls: string[] = [];
  const acquire = vi.fn(async (flowId: string, base?: string) => {
    calls.push(`acquire:${flowId}:${base}`);
    return { path: `/wt/${flowId}` };
  });
  const cleanup = vi.fn(async (flowId: string) => { calls.push(`cleanup:${flowId}`); });
  const prepare = buildCandidateSandbox({
    acquire,
    cleanup,
    applyChanges: vi.fn(async () => ({ appended: ["r1"], skipped: [] })),
    conventionsRelPath: "AGENTS.md",
    base: "main",
    newFlowId: () => "eval-cand-1",
    baselineFlowId: () => "eval-base-1",
  });

  const prep = await prepare([]);
  expect(prep.baselineCwd).toBe("/wt/eval-base-1");
  expect(prep.candidateCwd).toBe("/wt/eval-cand-1");
  expect(calls).toEqual(["acquire:eval-base-1:main", "acquire:eval-cand-1:main"]);

  await prep.cleanup();
  expect(calls.slice(2)).toEqual(["cleanup:eval-cand-1", "cleanup:eval-base-1"]);
});

test("候选准备失败时基线工作树也必须释放", async () => {
  const cleanup = vi.fn(async (_flowId: string) => {});
  const prepare = buildCandidateSandbox({
    acquire: vi.fn(async (flowId: string) => ({ path: `/wt/${flowId}` })),
    cleanup,
    applyChanges: vi.fn(async () => { throw new Error("apply failed"); }),
    conventionsRelPath: "AGENTS.md",
    base: "main",
    newFlowId: () => "eval-cand-1",
    baselineFlowId: () => "eval-base-1",
  });

  await expect(prepare([])).rejects.toThrow("apply failed");
  expect(cleanup.mock.calls.map((c) => c[0]).sort()).toEqual(["eval-base-1", "eval-cand-1"]);
});

test("不给 baselineFlowId 时行为不变：只开一个工作树、没有 baselineCwd", async () => {
  const acquire = vi.fn(async (flowId: string) => ({ path: `/wt/${flowId}` }));
  const cleanup = vi.fn(async (_flowId: string) => {});
  const prepare = buildCandidateSandbox({
    acquire,
    cleanup,
    applyChanges: vi.fn(async () => ({ appended: [], skipped: [] })),
    conventionsRelPath: "AGENTS.md",
    base: "main",
    newFlowId: () => "eval-cand-1",
  });

  const prep = await prepare([]);
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(prep.baselineCwd).toBeUndefined();
  await prep.cleanup();
  expect(cleanup).toHaveBeenCalledTimes(1);
});