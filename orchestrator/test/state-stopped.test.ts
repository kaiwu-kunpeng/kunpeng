import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { collectState } from "../src/server/state.js";

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-ss-")); });
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("stopped 流不计入 running、不报系统红灯、带 elapsedMs", async () => {
  const t = new FlowTracker(join(repo, ".kunpeng", "state"));
  await t.start("frun", "在跑");
  await t.start("fstop", "将停");
  await t.markStopped("fstop");
  const st = await collectState(new ArtifactStore(join(repo, ".kunpeng", "artifacts")), repo);
  expect(st.running.map((f) => f.flowId)).toEqual(["frun"]);
  expect(st.running.some((f) => f.flowId === "fstop")).toBe(false);
  expect(st.systemLight).not.toBe("red");
  const fstop = st.flows.find((f) => f.flowId === "fstop")!;
  expect(fstop.status).toBe("stopped");
  expect(typeof fstop.elapsedMs).toBe("number");
  expect(st.blockers.some((b) => b.flowId === "fstop")).toBe(false);
});
