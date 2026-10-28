import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runBacklogDriver } from "../../src/feedback/drive-backlog.js";
import { ReinjectStore } from "../../src/feedback/reinject-store.js";
import type { ReinjectEntry } from "../../src/feedback/reinject-store.js";
import type { ReinjectTask } from "../../src/feedback/finding-to-task.js";

const dirs: string[] = [];
const now = (): number => 1000;

async function makeStore(): Promise<ReinjectStore> {
  const dir = await mkdtemp(join(tmpdir(), "kunpeng-drive-backlog-"));
  dirs.push(dir);
  return new ReinjectStore(dir);
}

function task(fingerprint: string): ReinjectTask {
  return {
    fingerprint,
    requirement: `fix ${fingerprint}`,
    source: "guardian:typecheck",
    severity: "error",
  };
}

async function seed(store: ReinjectStore, fingerprints: string[]): Promise<void> {
  await store.enqueue(fingerprints.map((fingerprint) => task(fingerprint)), now());
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("verified 的条目被消费,backlog pending 减少", async () => {
  const store = await makeStore();
  await seed(store, ["one", "two"]);

  const report = await runBacklogDriver({
    store,
    now,
    runOne: async () => ({ status: "verified" }),
  });

  expect(report.consumed).toBe(2);
  expect(report.failed).toBe(0);
  expect(await store.pending()).toHaveLength(0);
  expect(await store.list({ status: "consumed" })).toHaveLength(2);
});

test("非 verified 不消费,保留待下次", async () => {
  const store = await makeStore();
  await seed(store, ["one", "two"]);

  const report = await runBacklogDriver({
    store,
    now,
    runOne: async () => ({ status: "rolled-back" }),
  });

  expect(report.consumed).toBe(0);
  expect(report.failed).toBe(2);
  expect(await store.pending()).toHaveLength(2);
});

test("max 限制本轮处理数", async () => {
  const store = await makeStore();
  await seed(store, ["one", "two", "three"]);

  const report = await runBacklogDriver({
    store,
    now,
    max: 1,
    runOne: async () => ({ status: "verified" }),
  });

  expect(report.picked).toBe(1);
  expect(report.consumed).toBe(1);
  expect(await store.pending()).toHaveLength(2);
});

test("stopOnFail 遇失败即停", async () => {
  const store = await makeStore();
  await seed(store, ["one", "two", "three"]);

  const report = await runBacklogDriver({
    store,
    now,
    stopOnFail: true,
    runOne: async () => ({ status: "rolled-back" }),
  });

  expect(report.picked).toBe(3);
  expect(report.outcomes).toHaveLength(1);
  expect(await store.pending()).toHaveLength(3);
});

test("runOne 抛错按 failed 计且不崩整轮", async () => {
  const store = await makeStore();
  await seed(store, ["one", "two"]);
  let calls = 0;

  const report = await runBacklogDriver({
    store,
    now,
    runOne: async (_requirement: string, _entry: ReinjectEntry) => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return { status: "verified" };
    },
  });

  expect(report.failed).toBe(1);
  expect(report.consumed).toBe(1);
  expect(report.outcomes[0]?.status.startsWith("error:")).toBe(true);
  expect(report.outcomes[0]?.consumed).toBe(false);
});

test("反复 rolled-back 的条目达 maxAttempts 后被 defer、不再被驱动", async () => {
  const store = await makeStore();
  await seed(store, ["one", "two"]);

  const report = await runBacklogDriver({
    store,
    now,
    maxAttempts: 1,
    runOne: async () => ({ status: "rolled-back" }),
  });

  expect(report.failed).toBe(2);
  expect(report.deferred).toBe(2);
  expect(await store.pending()).toHaveLength(0);
  expect((await store.list({ status: "deferred" })).map((entry) => entry.fingerprint)).toEqual(["one", "two"]);
});

test("maxAttempts 为 2 时单轮失败只累加 attempts 且保持 pending", async () => {
  const store = await makeStore();
  await seed(store, ["one"]);

  const report = await runBacklogDriver({
    store,
    now,
    maxAttempts: 2,
    runOne: async () => ({ status: "rolled-back" }),
  });

  expect(report.failed).toBe(1);
  expect(report.deferred).toBe(0);
  const pending = await store.pending();
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({ fingerprint: "one", status: "pending", attempts: 1 });
  expect(await store.list({ status: "deferred" })).toHaveLength(0);
});
