import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArtifactStore } from "../../src/artifacts/store.js";
import { collectState } from "../../src/server/state.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-evolution-upgrades-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("collectState exposes verified proposal upgrades with changes and evidence deltas", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));

  await store.write({
    kind: "proposal",
    id: "proposal-a",
    status: "verified",
    body: "升级 A\n\nmore details",
    meta: {
      proposal: {
        changes: [{ target: "conventions", text: "铁律X" }],
        evidence: { holdoutPassK: 0.9, baseline: { holdoutPassK: 0.8 } },
      },
    },
  });
  await store.write({
    kind: "proposal",
    id: "proposal-b",
    status: "draft",
    body: "升级 B",
    meta: {
      proposal: {
        changes: [{ target: "conventions", text: "不应出现" }],
        evidence: { holdoutPassK: 0.95, baseline: { holdoutPassK: 0.8 } },
      },
    },
  });
  await store.write({
    kind: "proposal",
    id: "proposal-c",
    status: "verified",
    body: "升级 C",
    meta: {
      proposal: {
        changes: [{ target: "conventions", text: "铁律Y" }],
      },
    },
  });

  const state = await collectState(store, dir);
  const upgrades = state.evolution!.upgrades;
  if (!upgrades) throw new Error("Missing upgrades in collected state");

  expect(upgrades.map((upgrade) => upgrade.id).sort()).toEqual(["proposal-a", "proposal-c"]);
  expect(upgrades.some((upgrade) => upgrade.id === "proposal-b")).toBe(false);

  const upgradeA = upgrades.find((upgrade) => upgrade.id === "proposal-a");
  expect(upgradeA?.changes).toContainEqual({ target: "conventions", text: "铁律X" });
  expect(upgradeA?.holdoutPassK).toBe(0.9);
  expect(upgradeA?.delta).toBeCloseTo(0.1);
});

test("collectState returns an empty upgrades array when no proposals are verified", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));

  await store.write({
    kind: "proposal",
    id: "proposal-draft",
    status: "draft",
    body: "draft proposal",
    meta: {
      proposal: {
        changes: [{ target: "conventions", text: "草稿" }],
      },
    },
  });

  const state = await collectState(store, dir);

  expect(state.evolution!.upgrades).toEqual([]);
});
