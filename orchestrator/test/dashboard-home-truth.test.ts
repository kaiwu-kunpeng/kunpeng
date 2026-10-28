import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../src/artifacts/store.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { collectState, relTime } from "../src/server/state.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-home-truth-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("relTime formats dashboard relative time buckets", () => {
  expect(relTime(30_000)).toBe("刚刚");
  expect(relTime(120_000)).toBe("2 分钟前");
  expect(relTime(7_200_000)).toBe("2 小时前");
  expect(relTime(172_800_000)).toBe("2 天前");
  expect(relTime(-5)).toBe("刚刚");
});

test("collectState aggregates main truth and flow activity from real git and tracker state", async () => {
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  await git.checkoutLocalBranch("main");

  writeFileSync(join(dir, "base.txt"), "base\n");
  await git.add("base.txt");
  await git.commit("initial main truth");

  await git.checkoutLocalBranch("kp/seg");
  writeFileSync(join(dir, "seg.txt"), "seg\n");
  await git.add("seg.txt");
  await git.commit("segment work");

  await git.checkout("main");
  await git.merge(["--no-ff", "kp/seg"]);

  const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));
  await tracker.start("flow-verified", "verified requirement");
  await tracker.finish("flow-verified", "verified");
  await tracker.start("flow-rolled", "rolled requirement");
  await tracker.finish("flow-rolled", "rolled-back");

  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  const state = await collectState(store, dir);

  expect(state.main).toBeDefined();
  expect(state.main!.commit).not.toBe("");
  expect(state.main!.mergedPlans).toBeGreaterThanOrEqual(1);
  expect(state.main!.subject).toContain("Merge branch 'kp/seg'");

  expect(state.activity).toBeDefined();
  expect(state.activity!.total).toBe(2);
  expect(state.activity!.verified).toBe(1);
  expect(state.activity!.rolledBack).toBe(1);
  expect(state.activity!.successRate).toBe(0.5);
  expect(state.activity!.recent).toHaveLength(2);
  for (const recent of state.activity!.recent) {
    expect(recent.agoText).not.toBe("");
  }
});
