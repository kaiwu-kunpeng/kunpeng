import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { startDashboard } from "../../src/server/http.js";
import type { SpawnFn } from "../../src/server/launch.js";
import { recordControlPlaneChanges } from "../../src/runtime/control-plane-audit.js";

let tmpRepo: string | undefined;
let stateDir: string | undefined;
let srv: { port: number; close: () => Promise<void> } | undefined;

afterEach(async () => {
  await srv?.close();
  srv = undefined;
  if (tmpRepo) rmSync(tmpRepo, { recursive: true, force: true });
  if (stateDir) rmSync(stateDir, { recursive: true, force: true });
  tmpRepo = undefined;
  stateDir = undefined;
});

test("GET /api/control-plane-audit 返回状态目录账本里的控制面变更", async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), "kp-cpa-route-repo-"));
  stateDir = mkdtempSync(join(tmpdir(), "kp-cpa-route-state-"));
  mkdirSync(join(tmpRepo, ".kunpeng"), { recursive: true });
  recordControlPlaneChanges(tmpRepo, { stateDir, now: () => 1 });
  writeFileSync(join(tmpRepo, ".kunpeng", "hooks.json"), '{"preMerge":["exit 0"]}');
  recordControlPlaneChanges(tmpRepo, { stateDir, now: () => 2 });
  const spawn = (() => ({ pid: 1, unref() {} }) as ChildProcess) as SpawnFn;
  srv = await startDashboard({ port: 0, repoRoot: tmpRepo, stateDir, execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/control-plane-audit?limit=1`);
  const json = await res.json() as { ok: boolean; changes: Array<{ file: string; at: number }> };
  expect(json.ok).toBe(true);
  expect(json.changes).toHaveLength(1);
  expect(json.changes[0]).toMatchObject({ file: ".kunpeng/hooks.json", at: 2 });
});