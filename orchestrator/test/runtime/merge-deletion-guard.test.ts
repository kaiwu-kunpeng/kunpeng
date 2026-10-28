import { expect, test } from "vitest";

import {
  findStaleDeletions,
  staleDeletions,
  type GuardGit,
} from "../../src/runtime/merge-deletion-guard.js";

function stubGit(diffResults: string[][], forkPoint = "fork0") {
  const diffCalls: string[][] = [];
  const mergeBaseCalls: Array<[string, string]> = [];
  let diffIndex = 0;
  const git: GuardGit = {
    async diffNames(args) {
      diffCalls.push(args);
      const result = diffResults[diffIndex] ?? [];
      diffIndex += 1;
      return result;
    },
    async mergeBase(a, b) {
      mergeBaseCalls.push([a, b]);
      return forkPoint;
    },
  };
  return { git, diffCalls, mergeBaseCalls };
}

test("staleDeletions 减去有意删除", () => {
  expect(staleDeletions(["a.ts", "b.ts"], ["b.ts"])).toEqual(["a.ts"]);
});

test("staleDeletions 全是有意删除→空", () => {
  expect(staleDeletions(["x"], ["x", "y"])).toEqual([]);
});

test("findStaleDeletions 命中陈旧删除(根因复现)", async () => {
  const branch = "kp/f1";
  const deleted = "orchestrator/src/feedback/flywheel.ts";
  const { git, diffCalls, mergeBaseCalls } = stubGit([[deleted], []], "fork0");

  await expect(findStaleDeletions(git, "base0", "after0", branch)).resolves.toEqual([deleted]);

  expect(mergeBaseCalls).toEqual([["base0", branch]]);
  expect(diffCalls).toEqual([
    ["--no-renames", "--diff-filter=D", "--name-only", "base0..after0"],
    ["--no-renames", "--diff-filter=D", "--name-only", `fork0..${branch}`],
  ]);
});

test("findStaleDeletions 无合并删除→[]且不查 mergeBase", async () => {
  const { git, diffCalls, mergeBaseCalls } = stubGit([[]]);

  await expect(findStaleDeletions(git, "base0", "after0", "kp/f1")).resolves.toEqual([]);

  expect(diffCalls).toEqual([["--no-renames", "--diff-filter=D", "--name-only", "base0..after0"]]);
  expect(mergeBaseCalls).toHaveLength(0);
});

test("findStaleDeletions 分支有意删除→放行", async () => {
  const { git } = stubGit([["x.ts"], ["x.ts"]]);

  await expect(findStaleDeletions(git, "base0", "after0", "kp/f1")).resolves.toEqual([]);
});
