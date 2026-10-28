import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { collectState } from "../../src/server/dashboard.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "kp-metrics-state-"));
  await mkdir(join(repoRoot, ".kunpeng", "artifacts"), { recursive: true });
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

test("collectState exposes F-07 metrics and reinject backlog from real stores", async () => {
  const store = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));

  const state = await collectState(store, repoRoot);

  expect(state.autoCompletion?.attempted).toBeDefined();
  expect(state.autoCompletion?.rate).toBe(1);
  expect(state.autoCompletion?.target).toBe(0.8);
  expect(state.autoCompletion?.meetsTarget).toBeDefined();

  expect(state.tokenTrend?.trend).toBeDefined();

  expect(state.gateConservation?.ok).toBe(true);
  expect(state.gateConservation?.allowed).toBeDefined();
  expect(state.gateConservation?.allowed.length).toBe(3);

  expect(state.reinjectBacklog?.pending).toBe(0);
});
