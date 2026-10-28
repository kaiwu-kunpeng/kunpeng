import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { RegressionStore } from "../src/evolution/regression-store.js";
import { runPatrol } from "../src/loop/patrol.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-patrol-sediment-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function seedVerifiedSpecs(store: ArtifactStore): Promise<void> {
  await store.write({
    kind: "spec",
    id: "flow-one",
    status: "verified",
    body: "implement one",
    meta: { testCmd: "npm test -- one.test.ts" },
  });
  await store.write({
    kind: "spec",
    id: "flow-two",
    status: "verified",
    body: "implement two",
    meta: { testCmd: "npm test -- two.test.ts" },
  });
}

test("runPatrol sediments verified specs into injected RegressionStore", async () => {
  const store = new ArtifactStore(join(dir, "artifacts"));
  const regressionStore = new RegressionStore(join(dir, "regression"));
  await seedVerifiedSpecs(store);

  const result = await runPatrol({ store, regressionStore, now: () => 1_700_000_000_000 });

  expect(result.sedimented).toBeGreaterThanOrEqual(1);
  const tasks = await regressionStore.list();
  expect(tasks).toHaveLength(2);
  expect(tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "flow-one",
      sourceFlow: "flow-one",
      requirement: expect.stringContaining("implement one"),
      acceptanceCmd: "npm test -- one.test.ts",
      createdAt: 1_700_000_000_000,
    }),
    expect.objectContaining({
      id: "flow-two",
      sourceFlow: "flow-two",
      requirement: expect.stringContaining("implement two"),
      acceptanceCmd: "npm test -- two.test.ts",
      createdAt: 1_700_000_000_000,
    }),
  ]));
});

test("runPatrol remains compatible when RegressionStore is not injected", async () => {
  const store = new ArtifactStore(join(dir, "artifacts"));
  await seedVerifiedSpecs(store);

  const result = await runPatrol({ store, now: () => 1 });

  expect(result.sedimented).toBe(0);
});

test("runPatrol sediment step is idempotent and does not overwrite existing tasks", async () => {
  const store = new ArtifactStore(join(dir, "artifacts"));
  const regressionStore = new RegressionStore(join(dir, "regression"));
  await seedVerifiedSpecs(store);

  const first = await runPatrol({ store, regressionStore, now: () => 1_700_000_000_000 });
  const afterFirst = await regressionStore.list();
  // 同一 now → 同 holdout 轮换期,不触发 rotate,纯验 sediment 幂等不覆盖
  const second = await runPatrol({ store, regressionStore, now: () => 1_700_000_000_000 });
  const afterSecond = await regressionStore.list();

  expect(first.sedimented).toBeGreaterThanOrEqual(1);
  expect(second.sedimented).toBe(0);
  expect(afterSecond).toHaveLength(afterFirst.length);
  expect(afterSecond).toEqual(afterFirst);
  expect(afterSecond.every((task) => task.createdAt === 1_700_000_000_000)).toBe(true);
});
