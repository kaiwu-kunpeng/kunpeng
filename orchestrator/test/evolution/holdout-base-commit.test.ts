import { describe, expect, test } from "vitest";
import type { Artifact } from "../../src/artifacts/types.js";
import {
  assignSet,
  holdoutRerunBase,
  tasksFromVerifiedSpecs,
  type RegressionTask,
} from "../../src/evolution/regression-store.js";

function spec(overrides: Partial<Artifact> & { meta?: Record<string, unknown> }): Artifact {
  const { meta, ...rest } = overrides;
  return {
    kind: "spec",
    id: "flow-1",
    status: "verified",
    body: "build the thing",
    ...rest,
    meta: { testCmd: "npx vitest run x", ...meta },
  };
}

function task(overrides: Partial<RegressionTask> = {}): RegressionTask {
  return {
    id: "flow-1",
    requirement: "build the thing",
    acceptanceCmd: "npx vitest run x",
    sourceFlow: "flow-1",
    set: "holdout",
    createdAt: 12345,
    ...overrides,
  };
}

describe("tasksFromVerifiedSpecs base commit", () => {
  test("reads meta.baseCommit into regression tasks", () => {
    const tasks = tasksFromVerifiedSpecs([
      spec({
        meta: { testCmd: "npx vitest run x", baseCommit: "abc123" },
      }),
    ], 12345);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.baseCommit).toBe("abc123");
  });

  test("falls back to meta.base when meta.baseCommit is absent", () => {
    const tasks = tasksFromVerifiedSpecs([
      spec({
        meta: { testCmd: "npx vitest run x", base: "def456" },
      }),
    ], 12345);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.baseCommit).toBe("def456");
  });

  test("omits baseCommit when no usable base information is present", () => {
    const tasks = tasksFromVerifiedSpecs([
      spec({
        meta: { testCmd: "npx vitest run x" },
      }),
    ], 12345);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.baseCommit).toBeUndefined();
    expect(tasks[0]).not.toHaveProperty("baseCommit");
  });

  test("does not regress verified specs without base information", () => {
    const now = 777;
    const tasks = tasksFromVerifiedSpecs([
      spec({
        id: "flow-without-base",
        body: "keep old sediment path working",
        meta: { testCmd: "npx vitest run legacy.test.ts" },
      }),
    ], now);

    expect(tasks).toEqual([
      {
        id: "flow-without-base",
        requirement: "keep old sediment path working",
        acceptanceCmd: "npx vitest run legacy.test.ts",
        sourceFlow: "flow-without-base",
        set: assignSet("flow-without-base"),
        createdAt: now,
      },
    ]);
    expect(tasks[0]?.baseCommit).toBeUndefined();
  });
});

describe("holdoutRerunBase", () => {
  test("returns task baseCommit when present", () => {
    expect(holdoutRerunBase(task({ baseCommit: "abc123" }))).toBe("abc123");
  });

  test("returns main when task has no baseCommit", () => {
    expect(holdoutRerunBase(task())).toBe("main");
  });

  test("returns custom fallback when task has no baseCommit", () => {
    expect(holdoutRerunBase(task(), "release-base")).toBe("release-base");
  });
});
