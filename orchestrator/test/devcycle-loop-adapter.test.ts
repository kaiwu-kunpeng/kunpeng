import { expect, test } from "vitest";
import { createDevCycleRunLoop } from "../src/loop/devcycle-loop-adapter.js";
import type { DriverEvent } from "../src/loop/workspace-driver.js";

test("flow/gate/done → stage/gate-needed/done;answerGate yes 触发 onMerge", async () => {
  const merged: string[] = [];
  const runLoop = createDevCycleRunLoop({
    runDevCycle: async (_ws, _msg, onEvent) => {
      onEvent({ type: "flow", flowId: "f1", stage: "spec", status: "running" });
      onEvent({ type: "flow", flowId: "f1", stage: "implement", status: "running" });
      onEvent({ type: "usage", flowId: "f1", stage: "implement", input: 10, output: 5, model: "test-model" });
      onEvent({ type: "gate", flowId: "f1", what: "合并主干?", detail: "kp/f1" });
      onEvent({ type: "done", flowId: "f1", status: "verified" });
    },
    onMerge: async (id) => {
      merged.push(id);
    },
    onReject: async () => {},
  });

  const handle = runLoop("ws1", "做点事");
  const seen: DriverEvent[] = [];
  let gateId = "";
  for await (const ev of handle.events) {
    seen.push(ev);
    if (ev.type === "gate-needed") {
      gateId = ev.gateId;
      handle.answerGate(ev.gateId, "yes");
    }
  }
  expect(seen.map((e) => e.type)).toEqual(["stage", "stage", "usage", "gate-needed", "done"]);
  expect(seen[0]).toMatchObject({ stage: "spec" });
  expect(seen[2]).toMatchObject({ type: "usage", input: 10, output: 5, model: "test-model" });
  expect(gateId).toBe("f1");
  await new Promise((r) => setTimeout(r, 0));
  expect(merged).toEqual(["f1"]);
});
