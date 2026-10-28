import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { collectState } from "../src/server/state.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-plan-summary-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

test("collectState includes plan body summary and counts only flows for that plan", async () => {
  const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));

  await store.write({
    kind: "plan",
    id: "plan-x",
    status: "verified",
    body: [
      "# First body line",
      "",
      "> Second body line",
      "Third body line",
      "Fourth body line",
    ].join("\n"),
    meta: {},
  });

  await tracker.start("flow-x-1", "first segment", { planId: "plan-x" });
  await tracker.start("flow-x-2", "second segment", { planId: "plan-x" });
  await tracker.start("flow-y-1", "other plan segment", { planId: "plan-y" });

  const state = await collectState(store, repo);
  const plan = state.plans.find((p) => p.id === "plan-x");

  expect(plan).toBeTruthy();
  expect(plan?.summary).toContain("First body line");
  expect(plan?.summary).toContain("Second body line");
  expect(plan?.summary).toContain("Third body line");
  expect(plan?.summary).not.toContain("#");
  expect(plan?.summary).not.toContain(">");
  expect(plan?.segmentCount).toBe(2);
});
