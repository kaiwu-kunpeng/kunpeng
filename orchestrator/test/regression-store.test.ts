import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Artifact } from "../src/artifacts/types.js";
import {
  assignSet,
  RegressionStore,
  tasksFromVerifiedSpecs,
  type RegressionSet,
  type RegressionTask,
} from "../src/evolution/regression-store.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-regression-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function sourceFlowFor(set: RegressionSet): string {
  for (let i = 0; i < 1_000; i += 1) {
    const sourceFlow = `flow-${set}-${i}`;
    if (assignSet(sourceFlow) === set) return sourceFlow;
  }
  throw new Error(`no sourceFlow found for ${set}`);
}

function task(id: string): RegressionTask {
  return {
    id,
    requirement: `requirement ${id}`,
    acceptanceCmd: `test ${id}`,
    sourceFlow: id,
    set: assignSet(id),
    createdAt: 12345,
  };
}

function spec(overrides: Partial<Artifact> & { meta?: Record<string, unknown> }): Artifact {
  const { meta, ...rest } = overrides;
  return {
    kind: "spec",
    id: "spec-1",
    status: "verified",
    body: "build the thing",
    ...rest,
    meta: { testCmd: "npm test", ...meta },
  };
}

describe("assignSet", () => {
  test("is deterministic and both regression sets are reachable", () => {
    const optimizationFlow = sourceFlowFor("optimization");
    const holdoutFlow = sourceFlowFor("holdout");

    expect(assignSet(optimizationFlow)).toBe("optimization");
    expect(assignSet(optimizationFlow)).toBe(assignSet(optimizationFlow));
    expect(assignSet(holdoutFlow)).toBe("holdout");
    expect(assignSet(holdoutFlow)).toBe(assignSet(holdoutFlow));
  });
});

describe("RegressionStore", () => {
  test("sediments a new task once and does not overwrite duplicate ids", async () => {
    const store = new RegressionStore(dir);
    const first = task("flow-idempotent");
    const duplicate = { ...first, requirement: "changed", acceptanceCmd: "changed" };

    await expect(store.has(first.id)).resolves.toBe(false);
    await expect(store.sediment(first)).resolves.toBe(true);
    await expect(store.has(first.id)).resolves.toBe(true);
    await expect(store.sediment(duplicate)).resolves.toBe(false);

    await expect(store.list()).resolves.toEqual([first]);
  });

  test("sediments long unicode ids without ENAMETOOLONG and round-trips", async () => {
    const store = new RegressionStore(dir);
    // 真实场景：中文 flow id，encodeURIComponent 后每字 9 字节 → 朴素文件名会超 255 字节崩溃
    const longId = "段一-纯逻辑层-去重-调度渲染-总控台摘要-三流并行-各独占文件-超长回归任务标识-0-0";
    const t = { ...task(longId) };

    await expect(store.has(t.id)).resolves.toBe(false);
    await expect(store.sediment(t)).resolves.toBe(true);
    await expect(store.has(t.id)).resolves.toBe(true);
    await expect(store.sediment(t)).resolves.toBe(false); // 幂等
    expect(await store.list()).toEqual([t]);
  });

  test("lists all tasks and filters by regression set", async () => {
    const store = new RegressionStore(dir);
    const holdout = task(sourceFlowFor("holdout"));
    const optimization = task(sourceFlowFor("optimization"));

    await store.sediment(holdout);
    await store.sediment(optimization);

    expect(await store.list("holdout")).toEqual([holdout]);
    expect(await store.list("optimization")).toEqual([optimization]);
    expect((await store.list()).slice().sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [holdout, optimization].slice().sort((a, b) => a.id.localeCompare(b.id)),
    );
  });
});

describe("tasksFromVerifiedSpecs", () => {
  test("maps verified specs from id and meta.testCmd", () => {
    const now = 777;
    const tasks = tasksFromVerifiedSpecs([
      spec({
        id: "flow-1",
        body: "做X",
        meta: { testCmd: "npx vitest run a.test.ts" },
      }),
    ], now);

    expect(tasks).toEqual([
      {
        id: "flow-1",
        requirement: "做X",
        acceptanceCmd: "npx vitest run a.test.ts",
        sourceFlow: "flow-1",
        set: assignSet("flow-1"),
        createdAt: now,
      },
    ]);
  });

  test("skips verified specs without replayable acceptance commands", () => {
    const tasks = tasksFromVerifiedSpecs([
      spec({
        id: "flow-no-command",
        meta: { testCmd: undefined, acceptance: undefined },
      }),
    ], 777);

    expect(tasks).toEqual([]);
  });

  test("skips non-verified specs", () => {
    const tasks = tasksFromVerifiedSpecs([
      spec({
        id: "flow-draft",
        status: "draft",
        meta: { testCmd: "npm test draft" },
      }),
    ], 777);

    expect(tasks).toEqual([]);
  });

  test("keeps compatibility with legacy acceptance strings and arrays", () => {
    const now = 777;
    const withStringAcceptance = spec({
      id: "flow-string",
      body: "requirement from body",
      meta: { testCmd: undefined, acceptance: "npm run verify" },
    });
    const withArrayAcceptance = spec({
      id: "flow-array",
      body: "array requirement",
      meta: { testCmd: undefined, acceptance: ["", "npm test array"] },
    });

    const tasks = tasksFromVerifiedSpecs([withStringAcceptance, withArrayAcceptance], now);

    expect(tasks).toEqual([
      {
        id: "flow-string",
        requirement: "requirement from body",
        acceptanceCmd: "npm run verify",
        sourceFlow: "flow-string",
        set: assignSet("flow-string"),
        createdAt: now,
      },
      {
        id: "flow-array",
        requirement: "array requirement",
        acceptanceCmd: "npm test array",
        sourceFlow: "flow-array",
        set: assignSet("flow-array"),
        createdAt: now,
      },
    ]);
  });

  test("sediments adapter output end-to-end and remains idempotent as a batch", async () => {
    const store = new RegressionStore(dir);
    const specs = [
      spec({ id: "flow-one", body: "one body", meta: { testCmd: "npm test one" } }),
      spec({ id: "flow-two", body: "two body", meta: { testCmd: undefined, acceptance: ["npm test two"] } }),
      spec({ id: "flow-skip", body: "skip body", meta: { testCmd: "" } }),
    ];
    const tasks = tasksFromVerifiedSpecs(specs, 999);

    const firstResults = await Promise.all(tasks.map((item) => store.sediment(item)));
    const secondResults = await Promise.all(tasks.map((item) => store.sediment(item)));

    expect(firstResults.filter(Boolean)).toHaveLength(tasks.length);
    expect(secondResults.filter(Boolean)).toHaveLength(0);
    expect((await store.list()).slice().sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      tasks.slice().sort((a, b) => a.id.localeCompare(b.id)),
    );
  });
});
