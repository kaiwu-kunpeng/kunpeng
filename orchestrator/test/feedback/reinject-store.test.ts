import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "vitest";
import { ReinjectStore } from "../../src/feedback/reinject-store.js";
import type { ReinjectTask } from "../../src/feedback/finding-to-task.js";

const dirs: string[] = [];

async function makeStore(): Promise<{ dir: string; store: ReinjectStore }> {
  const dir = await mkdtemp(join(tmpdir(), "kunpeng-reinject-store-"));
  dirs.push(dir);
  return { dir, store: new ReinjectStore(dir) };
}

function task(fingerprint: string): ReinjectTask {
  return {
    fingerprint,
    requirement: `fix ${fingerprint}`,
    source: "guardian:typecheck",
    severity: "error",
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("enqueue 去重——重复指纹只入一次", async () => {
  const { dir, store } = await makeStore();

  const first = await store.enqueue([task("same"), task("same")], 100);
  const second = await store.enqueue([task("same")], 200);

  expect(first).toEqual({ added: ["same"], skipped: ["same"] });
  expect(second).toEqual({ added: [], skipped: ["same"] });
  expect((await readdir(dir)).filter((file) => file === "same.json")).toHaveLength(1);
  expect(await store.list()).toHaveLength(1);
});

test("pending 只返回未消费的", async () => {
  const { store } = await makeStore();

  await store.enqueue([task("consumed"), task("still-pending")], 100);
  await store.markConsumed("consumed", 300);

  expect((await store.pending()).map((entry) => entry.fingerprint)).toEqual(["still-pending"]);
  const consumed = await store.list({ status: "consumed" });
  expect(consumed).toHaveLength(1);
  expect(consumed[0]).toMatchObject({ fingerprint: "consumed", status: "consumed", consumedAt: 300 });
});

test("list 按 createdAt 升序", async () => {
  const { store } = await makeStore();

  await store.enqueue([task("newer")], 200);
  await store.enqueue([task("older")], 100);

  expect((await store.list()).map((entry) => entry.fingerprint)).toEqual(["older", "newer"]);
});

test("markConsumed 对不存在指纹静默不抛", async () => {
  const { store } = await makeStore();

  await expect(store.markConsumed("nope", 1)).resolves.toBeUndefined();
});

test("recordFailure 累加 attempts,达阈值转 deferred 且 pending 不再返回它", async () => {
  const { store } = await makeStore();

  await store.enqueue([task("retry-me")], 100);

  await expect(store.recordFailure("retry-me", 200, 2)).resolves.toEqual({ attempts: 1, deferred: false });
  expect((await store.pending()).map((entry) => entry.fingerprint)).toEqual(["retry-me"]);

  await expect(store.recordFailure("retry-me", 300, 2)).resolves.toEqual({ attempts: 2, deferred: true });
  expect(await store.pending()).toHaveLength(0);

  const deferred = await store.list({ status: "deferred" });
  expect(deferred).toHaveLength(1);
  expect(deferred[0]).toMatchObject({
    fingerprint: "retry-me",
    status: "deferred",
    attempts: 2,
    lastFailedAt: 300,
  });
});
