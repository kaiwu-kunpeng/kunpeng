import { expect, test } from "vitest";

import { diagnoseGate, type GateGit } from "../../src/runtime/gate-diagnosis.js";

interface StubOptions {
  branchExists?: boolean;
  unmergedCommits?: number;
  commitsBehind?: number | Error;
  mergeConflictFiles?: string[];
}

function stubGateGit(options: StubOptions = {}) {
  const calls: Record<keyof GateGit, string[][]> = {
    branchExists: [],
    unmergedCommits: [],
    commitsBehind: [],
    mergeConflictFiles: [],
  };

  const git: GateGit = {
    async branchExists(branch) {
      calls.branchExists.push([branch]);
      return options.branchExists ?? true;
    },
    async unmergedCommits(branch, base) {
      calls.unmergedCommits.push([branch, base]);
      return options.unmergedCommits ?? 0;
    },
    async commitsBehind(branch, base) {
      calls.commitsBehind.push([branch, base]);
      if (options.commitsBehind instanceof Error) {
        throw options.commitsBehind;
      }
      return options.commitsBehind ?? 0;
    },
    async mergeConflictFiles(branch, base) {
      calls.mergeConflictFiles.push([branch, base]);
      return options.mergeConflictFiles ?? [];
    },
  };

  return { git, calls };
}

test("分支不存在→branch-missing", async () => {
  const { git, calls } = stubGateGit({ branchExists: false });

  await expect(diagnoseGate(git, "flow-1")).resolves.toEqual({
    flowId: "flow-1",
    status: "branch-missing",
    commitsBehind: 0,
    conflictFiles: [],
  });

  expect(calls.branchExists).toEqual([["kp/flow-1"]]);
  expect(calls.commitsBehind).toHaveLength(0);
  expect(calls.unmergedCommits).toHaveLength(0);
  expect(calls.mergeConflictFiles).toHaveLength(0);
});

test("已被吸收(unmerged 0)→ghost", async () => {
  const { git, calls } = stubGateGit({
    branchExists: true,
    unmergedCommits: 0,
    commitsBehind: 5,
  });

  await expect(diagnoseGate(git, "flow-2")).resolves.toEqual({
    flowId: "flow-2",
    status: "ghost",
    commitsBehind: 5,
    conflictFiles: [],
  });

  expect(calls.branchExists).toEqual([["kp/flow-2"]]);
  expect(calls.commitsBehind).toEqual([["kp/flow-2", "main"]]);
  expect(calls.unmergedCommits).toEqual([["kp/flow-2", "main"]]);
  expect(calls.mergeConflictFiles).toHaveLength(0);
});

test("有未合 commit + 有冲突→stale-conflict", async () => {
  const { git, calls } = stubGateGit({
    unmergedCommits: 2,
    commitsBehind: 40,
    mergeConflictFiles: ["state.ts", "evolution.ts"],
  });

  await expect(diagnoseGate(git, "flow-3")).resolves.toEqual({
    flowId: "flow-3",
    status: "stale-conflict",
    commitsBehind: 40,
    conflictFiles: ["state.ts", "evolution.ts"],
  });

  expect(calls.branchExists).toEqual([["kp/flow-3"]]);
  expect(calls.commitsBehind).toEqual([["kp/flow-3", "main"]]);
  expect(calls.unmergedCommits).toEqual([["kp/flow-3", "main"]]);
  expect(calls.mergeConflictFiles).toEqual([["kp/flow-3", "main"]]);
});

test("有未合 commit + 无冲突→mergeable", async () => {
  const { git, calls } = stubGateGit({
    unmergedCommits: 2,
    mergeConflictFiles: [],
  });

  await expect(diagnoseGate(git, "flow-4")).resolves.toEqual({
    flowId: "flow-4",
    status: "mergeable",
    commitsBehind: 0,
    conflictFiles: [],
  });

  expect(calls.branchExists).toEqual([["kp/flow-4"]]);
  expect(calls.commitsBehind).toEqual([["kp/flow-4", "main"]]);
  expect(calls.unmergedCommits).toEqual([["kp/flow-4", "main"]]);
  expect(calls.mergeConflictFiles).toEqual([["kp/flow-4", "main"]]);
});

test("commitsBehind 读失败→记 0 不抛", async () => {
  const { git, calls } = stubGateGit({
    branchExists: true,
    commitsBehind: new Error("rev-list failed"),
    unmergedCommits: 0,
  });

  await expect(diagnoseGate(git, "flow-5")).resolves.toEqual({
    flowId: "flow-5",
    status: "ghost",
    commitsBehind: 0,
    conflictFiles: [],
  });

  expect(calls.branchExists).toEqual([["kp/flow-5"]]);
  expect(calls.commitsBehind).toEqual([["kp/flow-5", "main"]]);
  expect(calls.unmergedCommits).toEqual([["kp/flow-5", "main"]]);
  expect(calls.mergeConflictFiles).toHaveLength(0);
});
