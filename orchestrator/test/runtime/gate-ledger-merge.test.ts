import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { mergeAndClearGate, runMergeCommand } from "../../src/runtime/merge-gate.js";

let repo: string;
let prevKunpengState: string | undefined;
let prevKunpengInstance: string | undefined;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-gate-ledger-merge-"));
  prevKunpengState = process.env.KUNPENG_STATE;
  prevKunpengInstance = process.env.KUNPENG_INSTANCE;
  process.env.KUNPENG_STATE = join(repo, "global-state");
  process.env.KUNPENG_INSTANCE = "gate-ledger-test";
  const g = simpleGit(repo);
  await g.init(); await g.addConfig("user.email", "t@t").addConfig("user.name", "t");
  await g.checkoutLocalBranch("main");
  writeFileSync(join(repo, "a.txt"), "base"); await g.add("a.txt"); await g.commit("base");
  await g.checkoutLocalBranch("kp/f1");
  writeFileSync(join(repo, "b.txt"), "feat"); await g.add("b.txt"); await g.commit("feat on f1");
  await g.checkout("main");
  const t = new FlowTracker(join(repo, ".kunpeng", "state"));
  await t.start("f1", "造门用");
  await t.finish("f1", "verified", { gate: "合并主干 (人工门#1)", what: "kp/f1 → main" });
});
afterEach(() => {
  if (prevKunpengState === undefined) delete process.env.KUNPENG_STATE;
  else process.env.KUNPENG_STATE = prevKunpengState;
  if (prevKunpengInstance === undefined) delete process.env.KUNPENG_INSTANCE;
  else process.env.KUNPENG_INSTANCE = prevKunpengInstance;
  rmSync(repo, { recursive: true, force: true });
});

test("mergeAndClearGate 带 clearedBy → 合并后账本记 human/cli-merge/tier", async () => {
  const r = await mergeAndClearGate(repo, "f1", "main", { clearedBy: { by: "human", via: "cli-merge", durationTier: "medium" } });
  expect(r.ok).toBe(true);
  const s = (await new FlowTracker(join(repo, ".kunpeng", "state")).read("f1"))!;
  expect(s.humanGate).toBeUndefined();
  expect(s.gateLedger).toHaveLength(1);
  expect(s.gateLedger![0]).toMatchObject({ gate: "合并主干 (人工门#1)", what: "kp/f1 → main", by: "human", via: "cli-merge", durationTier: "medium", planGate: false });
  expect(s.gateLedger![0]!.closedAt).toBeGreaterThanOrEqual(s.gateLedger![0]!.openedAt);
});

test("不带 clearedBy → 账本 by=unknown via=merge-gate（合并仍成功）", async () => {
  const r = await runMergeCommand(["f1"], repo);
  expect(r.ok).toBe(true);
  const s = (await new FlowTracker(join(repo, ".kunpeng", "state")).read("f1"))!;
  expect(s.gateLedger![0]).toMatchObject({ by: "unknown", via: "merge-gate" });
});