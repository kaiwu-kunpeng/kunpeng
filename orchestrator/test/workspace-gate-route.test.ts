import { expect, test } from "vitest";
import { handleGate } from "../src/server/workspace-endpoints.js";
import type { WorkspaceDriver } from "../src/loop/workspace-driver.js";

test("handleGate 合法→调 answerGate 回 ok;非法→不调、回错", async () => {
  const calls: Array<[string, string, string]> = [];
  const driver: Pick<WorkspaceDriver, "answerGate"> = {
    answerGate: (w: string, g: string, d: "yes" | "no") => { calls.push([w, g, d]); },
  };

  const ok = await handleGate(driver, "ws1", { gateId: "f1", decision: "yes" });
  expect(ok).toEqual({ ok: true });
  expect(calls).toEqual([["ws1", "f1", "yes"]]);

  const bad = await handleGate(driver, "ws1", { gateId: "", decision: "maybe" });
  expect(bad.ok).toBe(false);
  expect(calls).toHaveLength(1); // 未再调
});
