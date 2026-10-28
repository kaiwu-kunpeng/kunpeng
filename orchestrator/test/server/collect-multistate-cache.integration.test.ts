import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProject } from "../../src/project/registry.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { collectMultiState, __clearStateCache } from "../../src/server/state.js";

let state: string, parent: string, repo: string;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "kp-cache-state-"));
  parent = mkdtempSync(join(tmpdir(), "kp-cache-pa-"));
  repo = join(parent, "alpha");
  mkdirSync(repo);
});
afterEach(() => {
  __clearStateCache();
  [state, parent].forEach((d) => rmSync(d, { recursive: true, force: true }));
});

test("TTL 内重复 collectMultiState 命中缓存:返回同一 state 对象引用(未重算)", async () => {
  __clearStateCache();
  await registerProject({ repoPath: repo, name: "Alpha", stateDir: state, now: 1 });
  await new FlowTracker(join(repo, ".kunpeng", "state")).start("a1", "do A");

  const s1 = await collectMultiState(state);
  const s2 = await collectMultiState(state);
  expect(s1).toHaveLength(1);
  expect(s2).toHaveLength(1);
  // 命中缓存的铁证:第二次返回的是【同一个】state 对象引用(没有重新跑 collectState)
  expect(s2[0].state).toBe(s1[0].state);
  // 内容仍正确
  expect(s1[0].state.flows.map((f) => f.flowId)).toContain("a1");
});

test("__clearStateCache 后重算:返回不同的 state 对象引用", async () => {
  __clearStateCache();
  await registerProject({ repoPath: repo, name: "Alpha", stateDir: state, now: 1 });
  await new FlowTracker(join(repo, ".kunpeng", "state")).start("a1", "do A");

  const s1 = await collectMultiState(state);
  __clearStateCache();
  const s3 = await collectMultiState(state);
  expect(s3[0].state).not.toBe(s1[0].state); // 清空后是新对象
  expect(s3[0].state.flows.map((f) => f.flowId)).toContain("a1"); // 内容仍对
});