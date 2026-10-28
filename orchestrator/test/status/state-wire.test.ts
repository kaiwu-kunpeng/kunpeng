import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { collectState } from "../../src/server/state.js";

let repoRoot: string | undefined;
let previousKunpengState: string | undefined;

afterEach(() => {
  if (previousKunpengState === undefined) {
    delete process.env.KUNPENG_STATE;
  } else {
    process.env.KUNPENG_STATE = previousKunpengState;
  }
  previousKunpengState = undefined;

  if (repoRoot) {
    rmSync(repoRoot, { recursive: true, force: true });
    repoRoot = undefined;
  }
});

test("collectState wires moduleStatus from the dashboard truth projection", async () => {
  repoRoot = mkdtempSync(join(tmpdir(), "kunpeng-state-wire-"));
  previousKunpengState = process.env.KUNPENG_STATE;
  process.env.KUNPENG_STATE = join(repoRoot, ".kunpeng");

  const artifactDir = join(repoRoot, ".kunpeng", "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  const store = new ArtifactStore(artifactDir);

  const state = await collectState(store, repoRoot);

  expect(state.moduleStatus).toBeDefined();
  expect(state.moduleStatus!.modules.length).toBe(20);
  expect(
    state.moduleStatus!.rollup.green
      + state.moduleStatus!.rollup.yellow
      + state.moduleStatus!.rollup.red
      + state.moduleStatus!.rollup.idle,
  ).toBe(20);

  for (const moduleStatus of state.moduleStatus!.modules) {
    expect(moduleStatus.id).toBeTruthy();
    expect(moduleStatus.name).toBeTruthy();
    expect(moduleStatus.light).toBeTruthy();
  }
});
