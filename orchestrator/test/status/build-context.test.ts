import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { buildStatusContext } from "../../src/status/build-context.js";
import { collectModuleStatus } from "../../src/status/collect-module-status.js";

let repoRoot: string;
let stateDir: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "kp-status-repo-"));
  stateDir = mkdtempSync(join(tmpdir(), "kp-status-state-"));

  const kp = join(repoRoot, ".kunpeng");
  mkdirSync(join(kp, "captures"), { recursive: true });
  mkdirSync(join(kp, "product"), { recursive: true });
  mkdirSync(join(kp, "artifacts"), { recursive: true });
  mkdirSync(join(stateDir, "switchboard"), { recursive: true });

  writeFileSync(join(kp, "captures", "capture.txt"), "captured");
  writeFileSync(join(kp, "product", "product.md"), "product");
  writeFileSync(join(kp, "artifacts", "spec.md"), "spec");
  writeFileSync(join(kp, "board.json"), "{}");
  writeFileSync(join(repoRoot, "AGENTS.md"), "# agents");
  writeFileSync(
    join(stateDir, "switchboard", "old.json"),
    JSON.stringify({ ts: 1_800_000_000_000, from: "old-agent", read: false }),
  );
  writeFileSync(
    join(stateDir, "switchboard", "new.json"),
    JSON.stringify({ ts: 1_800_000_100_000, from: "new-agent", read: true }),
  );
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

test("buildStatusContext 从真实 fs 和调用方真值组装 StatusContext", async () => {
  const now = 1_800_000_200_000;
  const truths = {
    flows: [{ status: "verified", stage: "done", updatedAt: now - 30_000 }],
    health: { alerts: [], running: 0, healthy: 1 },
    evolution: { pendingCount: 1, approvedCount: 2, lastRunText: "last evolution" },
    quota: { total: 42, accounts: [{ id: "main" }] },
    branches: ["kp/bon-x"],
    lastMergeAt: 1_800_000_150_000,
  };

  const ctx = await buildStatusContext({ repoRoot, stateDir, now, truths });

  expect(ctx.artifactLatest.url).toEqual(expect.any(Number));
  expect(ctx.artifactLatest.form).toEqual(expect.any(Number));
  expect(ctx.artifactLatest.spec).toEqual(expect.any(Number));
  expect(ctx.artifactLatest.pri).toBeUndefined();
  expect(ctx.artifactLatest.merge).toBe(1_800_000_150_000);

  expect(ctx.switchboard?.unread).toBe(1);
  expect(ctx.switchboard?.lastAt).toBe(1_800_000_100_000);
  expect(ctx.switchboard?.lastFrom).toBe("new-agent");

  expect(ctx.mtimes?.["agents-md"]).toEqual(expect.any(Number));
  expect(ctx.mtimes?.board).toEqual(expect.any(Number));
  expect(ctx.online?.switchboard).toBe(true);
  expect(ctx.online?.serve).toBe(false);

  expect(ctx.wired["knowledge-inbox"]).toBe(true);
  expect(ctx.wired["perf-loop"]).toBe(false);
  expect(ctx.wired["dev-cycle"]).toBe(true);
  expect(Object.keys(ctx.wired).length).toBe(20);

  expect(ctx.flows).toBe(truths.flows);
  expect(ctx.health).toBe(truths.health);
  expect(ctx.branches).toBe(truths.branches);

  const report = collectModuleStatus(ctx);
  const knowledgeInbox = report.modules.find((module) => module.id === "knowledge-inbox");
  expect(report.modules.length).toBe(20);
  expect(knowledgeInbox?.light).not.toBe("idle");
});

test("buildStatusContext 不传 lastMergeAt 时不设置 merge 活动", async () => {
  const now = 1_800_000_200_000;
  const ctx = await buildStatusContext({
    repoRoot,
    stateDir,
    now,
    truths: {
      flows: [],
      health: { alerts: [], running: 0, healthy: 1 },
      branches: [],
    },
  });

  expect(ctx.artifactLatest.merge).toBeUndefined();
});
