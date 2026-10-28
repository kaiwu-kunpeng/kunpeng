import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkspaceDriver } from "../src/server/workspace-endpoints.js";
import type { KunpengEvent } from "../src/sdk/events.js";

test("buildWorkspaceDriver:注入 fake runDevCycle → say 流式 stage/done;门 yes 触发 onMerge", async () => {
  const merged: string[] = [];
  const driver = buildWorkspaceDriver({
    transcriptDir: mkdtempSync(join(tmpdir(), "wsw-")),
    runDevCycle: async (_ws, _msg, onEvent: (e: KunpengEvent) => void) => {
      onEvent({ type: "flow", flowId: "f9", stage: "spec", status: "running" });
      onEvent({ type: "gate", flowId: "f9", what: "合并?", detail: "kp/f9" });
      onEvent({ type: "done", flowId: "f9", status: "verified" });
    },
    onMerge: async (id) => { merged.push(id); },
  });

  const seen: string[] = [];
  for await (const ev of driver.say("ws1", "做事")) {
    seen.push(ev.type);
    if (ev.type === "gate-needed") driver.answerGate("ws1", ev.gateId, "yes");
  }
  expect(seen).toEqual(["stage", "gate-needed", "done"]);
  await new Promise((r) => setTimeout(r, 0));
  expect(merged).toEqual(["f9"]);
});
