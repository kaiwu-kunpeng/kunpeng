import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { collectState } from "../src/server/dashboard.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-dashboard-crashed-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("collectState keeps crashed flows visible without ETA and turns system red", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));

  await tracker.start("crashed-flow", "crashed task");
  await tracker.enter("crashed-flow", "implement", true);
  await tracker.markCrashed("crashed-flow");

  await tracker.start("done-flow", "done task");
  await tracker.finish("done-flow", "verified");

  await tracker.start("live-flow", "live task");

  const state = await collectState(store, dir);

  // 系统灯：有 crashed → 红
  expect(state.systemLight).toBe("red");

  // crashed 流绝不计入 running —— 否则 board.json activeFlows / 「运行中流」计数 / 「调度 N 条流」对外虚报并发度
  expect(state.running.find((f) => f.flowId === "crashed-flow")).toBeUndefined();
  expect(state.running.every((f) => f.status === "running")).toBe(true);
  expect(state.running.map((f) => f.flowId)).toContain("live-flow");

  // crashed 仍可见：经 blockers 暴露（带崩溃原因），且在完整 flows 列表里状态/灯正确
  expect(state.blockers.find((b) => b.flowId === "crashed-flow")).toBeDefined();
  const cf = state.flows.find((f) => f.flowId === "crashed-flow");
  expect(cf?.status).toBe("crashed");
  expect(cf?.light).toBe("red");
  expect(cf?.etaRemainingMs).toBeUndefined();
  expect(typeof cf?.elapsedMs).toBe("number");

  // crashed 不计入 finished（ETA 基准）；看门狗不对其报卡死
  expect(state.flows.filter((f) => f.status !== "running" && f.status !== "crashed").map((f) => f.flowId)).toContain("done-flow");
  expect(state.health.alerts.find((a) => a.flowId === "crashed-flow")).toBeUndefined();
});
