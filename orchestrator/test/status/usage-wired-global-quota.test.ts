import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { buildStatusContext } from "../../src/status/build-context.js";
import { collectModuleStatus } from "../../src/status/collect-module-status.js";

let repoRoot: string;
let stateDir: string;

const BASE_TRUTHS = {
  flows: [],
  health: { alerts: [], running: 0, healthy: 0 },
  branches: [],
};

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "kp-usage-repo-"));
  stateDir = mkdtempSync(join(tmpdir(), "kp-usage-state-"));
  mkdirSync(join(repoRoot, ".kunpeng"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

test("目标仓库没有 quota.json,但调用方传了全局 quota 真值时,usage 仍算接线且不红", async () => {
  const now = 1_800_000_000_000;
  const ctx = await buildStatusContext({
    repoRoot,
    stateDir,
    now,
    truths: { ...BASE_TRUTHS, quota: { total: 3, accounts: [{ id: "acct-1" }] } },
  });
  expect(ctx.wired.usage).toBe(true);

  const usage = collectModuleStatus(ctx).modules.find((m) => m.id === "usage");
  expect(usage?.wired).toBe(true);
  expect(usage?.light).not.toBe("red");
});

test("既没有本地 quota.json 也没有全局 quota 真值时,usage 诚实报未接线", async () => {
  const ctx = await buildStatusContext({
    repoRoot,
    stateDir,
    now: 1_800_000_000_000,
    truths: { ...BASE_TRUTHS },
  });
  expect(ctx.wired.usage).toBe(false);
  expect(collectModuleStatus(ctx).modules.find((m) => m.id === "usage")?.light).toBe("red");
});

test("目标仓库本地有 quota.json 时,即便调用方没传 quota 真值也算接线", async () => {
  writeFileSync(join(repoRoot, ".kunpeng", "quota.json"), JSON.stringify({ schema: "kunpeng-quota/v1", records: [] }));
  const ctx = await buildStatusContext({
    repoRoot,
    stateDir,
    now: 1_800_000_000_000,
    truths: { ...BASE_TRUTHS },
  });
  expect(ctx.wired.usage).toBe(true);
});