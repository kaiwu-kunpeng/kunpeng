import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { backfillRollbackAttribution } from "../../src/metrics/rollback-heatmap.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-backfill-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function seed(): Promise<FlowTracker> {
  const t = new FlowTracker(join(dir, "state"), () => 1_700_000_000_000);
  await t.start("has-kind", "a");
  await t.setRollback("has-kind", { kind: "test-failed", summary: "FAIL", attempt: 1 });
  await t.finish("has-kind", "rolled-back", undefined, "FAIL x");
  await t.start("contention", "b");
  await t.finish("contention", "rolled-back", undefined, "dev-cycle 异常: Error: Preparing worktree (new branch 'kp/b')\nfatal: 'kp/b' is already checked out");
  await t.start("audit", "c");
  await t.finish("audit", "rolled-back", undefined, "验收测试审计未通过: vitest 命令点名的测试文件不存在: a.test.ts");
  await t.start("odd", "d");
  await t.finish("odd", "rolled-back", undefined, "something odd");
  await t.start("crashed", "e");
  await t.enter("crashed", "implement", true);
  await t.markCrashed("crashed", "lease-expired");
  await t.start("fine", "f");
  await t.finish("fine", "verified");
  return t;
}

test("dry-run 只列不写；真跑给缺 rollback 的流补 kind，unknown 不写，已有的不动", async () => {
  const t = await seed();
  const dry = await backfillRollbackAttribution(t, { dryRun: true });
  expect(dry.scanned).toBe(5);
  expect(dry.updated).toBe(0);
  expect(dry.skippedHasRollback).toBe(1);
  expect(dry.unknown).toBe(1);
  expect(dry.entries.map((e) => [e.flowId, e.kind]).sort()).toEqual([["audit", "audit-rejected"], ["contention", "worktree-contention"], ["crashed", "crashed"]]);
  expect((await t.read("contention"))!.rollback).toBeUndefined();

  const real = await backfillRollbackAttribution(t, {});
  expect(real.updated).toBe(3);
  expect(real.unknown).toBe(1);
  const c = (await t.read("contention"))!;
  expect(c.rollback).toMatchObject({ kind: "worktree-contention", attempt: 0, source: "backfill" });
  expect(c.rollback?.summary).toContain("Preparing worktree");
  expect(c.history.length).toBe(1);
  expect((await t.read("crashed"))!.rollback?.kind).toBe("crashed");
  expect((await t.read("odd"))!.rollback).toBeUndefined();
  expect((await t.read("has-kind"))!.rollback?.kind).toBe("test-failed");
  expect((await t.read("fine"))!.rollback).toBeUndefined();

  const again = await backfillRollbackAttribution(t, {});
  expect(again.updated).toBe(0);
  expect(again.skippedHasRollback).toBe(4);
});