import { expect, test } from "vitest";
import { collectModuleStatus } from "../../src/status/collect-module-status.js";
import { deriveLight } from "../../src/status/derive-light.js";
import { MODULE_REGISTRY } from "../../src/status/module-registry.js";
import type { Category, StatusContext } from "../../src/status/types.js";

const validCategories = new Set<Category>(["research-loop", "comms", "governance", "ops", "platform"]);

function allWired(): Record<string, boolean> {
  return Object.fromEntries(MODULE_REGISTRY.map((module) => [module.id, true]));
}

function baseContext(): StatusContext {
  const now = 1_800_000_000_000;
  return {
    now,
    wired: allWired(),
    artifactCounts: {},
    artifactLatest: {
      url: now - 60_000,
      text: now - 120_000,
      pri: now - 300_000,
      spec: now - 400_000,
      merge: now - 500_000,
      form: now - 600_000,
      plan: now - 700_000,
      "design-selection": now - 800_000,
      network: now - 900_000,
      connector: now - 1_000_000,
    },
    flows: [{ status: "verified", stage: "done", updatedAt: now - 90_000 }],
    health: { alerts: [], running: 1, healthy: 1 },
    evolution: { pendingCount: 1, approvedCount: 2, lastRunText: "最近自进化巡检" },
    patrol: { pendingCount: 0, lastRunText: "最近巡检完成" },
    quota: { total: 100, accounts: [{ id: "main" }] },
    branches: ["kp/bon-a", "main"],
    switchboard: { unread: 2, lastAt: now - 30_000, lastFrom: "cockpit" },
    mtimes: { "agents-md": now - 40_000, board: now - 50_000 },
    online: { switchboard: true, watchdog: true, serve: true },
  };
}

function moduleById(ctx: StatusContext, id: string) {
  const status = collectModuleStatus(ctx).modules.find((module) => module.id === id);
  expect(status, `missing module ${id}`).toBeDefined();
  return status!;
}

test("注册表完整且 id 唯一", () => {
  expect(MODULE_REGISTRY.length).toBe(20);
  expect(new Set(MODULE_REGISTRY.map((module) => module.id)).size).toBe(20);
  for (const module of MODULE_REGISTRY) {
    expect(module.name.trim().length).toBeGreaterThan(0);
    expect(validCategories.has(module.category)).toBe(true);
  }
});

test("deriveLight 四态", () => {
  expect(deriveLight({ wired: false, hasActivity: true })).toBe("red");
  expect(deriveLight({ wired: true, hasActivity: false })).toBe("idle");
  expect(deriveLight({ wired: true, hasActivity: true })).toBe("green");
  expect(deriveLight({ wired: true, hasActivity: true, lastOk: true })).toBe("green");
  expect(deriveLight({ wired: true, hasActivity: true, lastOk: false })).toBe("red");
  expect(deriveLight({ wired: true, hasActivity: true, pending: 2, lastOk: true })).toBe("yellow");
});

test("collectModuleStatus:rollup 计数等于各灯之和且 modules 数=注册表数", () => {
  const ctx = baseContext();
  const report = collectModuleStatus(ctx);

  expect(report.modules.length).toBe(20);
  expect(report.rollup.green + report.rollup.yellow + report.rollup.red + report.rollup.idle).toBe(20);
  expect(report.generatedAt).toBe(ctx.now);
});

test("代表性模块灯色", () => {
  const ctx = baseContext();
  ctx.wired["perf-loop"] = false;

  expect(moduleById(ctx, "switchboard").light).toBe("yellow");
  expect(moduleById(ctx, "usage").light).toBe("green");
  expect(moduleById(ctx, "perf-loop").light).toBe("red");
  expect(moduleById(ctx, "security-review").light).toBe("idle");
});

test("evolution 和 patrol note 清理裸毫秒时间戳", () => {
  const ctx = baseContext();
  ctx.now = 1_700_000_060_000;
  ctx.wired = allWired();
  ctx.evolution = { pendingCount: 1, approvedCount: 2, lastRunText: "最近自进化巡检 @1700000000000" };
  ctx.patrol = { pendingCount: 0, lastRunText: "最近巡检 @1700000000000" };

  const evolution = moduleById(ctx, "evolution-flywheel");
  const patrol = moduleById(ctx, "patrol");
  expect(evolution.note).not.toMatch(/@\d{10,}/);
  expect(evolution.note).toContain("(");
  expect(patrol.note).not.toMatch(/@\d{10,}/);
  expect(patrol.note).toContain("(");
});
