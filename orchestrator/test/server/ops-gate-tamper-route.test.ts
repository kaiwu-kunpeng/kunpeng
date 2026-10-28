import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { startDashboard } from "../../src/server/http.js";
import type { SpawnFn } from "../../src/server/launch.js";
import { createOpsGate, listOpsGates } from "../../src/loop/ops-gate.js";

let tmpRepo: string | undefined;
let srv: { port: number; close: () => Promise<void> } | undefined;

afterEach(async () => {
  await srv?.close();
  srv = undefined;
  if (tmpRepo) rmSync(tmpRepo, { recursive: true, force: true });
  tmpRepo = undefined;
});

function spawnRecorder() {
  const calls: { cmd: string; args: string[] }[] = [];
  const spawn = ((cmd: string, args?: readonly string[]) => {
    calls.push({ cmd, args: [...(args ?? [])] });
    return { pid: 4242, unref() {} } as ChildProcess;
  }) as SpawnFn;
  return { calls, spawn };
}

async function decide(port: number, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/ops-gate-decide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

test("必先红 ②：篡改成 approved 的门文件 → 裁决接口 400 且绝不起跑 loop", async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), "kp-ops-gate-tamper-"));
  mkdirSync(join(tmpRepo, ".kunpeng", "ops-gates"), { recursive: true });
  writeFileSync(join(tmpRepo, ".kunpeng", "ops-gates", "opsgate-t1.json"), JSON.stringify({ id: "opsgate-t1", projectId: "x", playbookId: "pb1", loopId: "loop-a", reason: "预先批准", status: "approved", createdAt: 1, decidedAt: 2 }));
  const { calls, spawn } = spawnRecorder();
  srv = await startDashboard({ port: 0, repoRoot: tmpRepo, execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn });
  const { status, json } = await decide(srv.port, { id: "opsgate-t1", decision: "approve" });
  expect(status).toBe(400);
  expect(json.ok).toBe(false);
  expect(calls).toHaveLength(0);
});

test("正常裁决 → 存储条目 decidedBy=cockpit，loop 起跑一次", async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), "kp-ops-gate-decide-"));
  const gate = await createOpsGate(tmpRepo, { projectId: "x", playbookId: "pb1", loopId: "loop-a", reason: "r" }, 1000);
  const { calls, spawn } = spawnRecorder();
  srv = await startDashboard({ port: 0, repoRoot: tmpRepo, execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn });
  const { status, json } = await decide(srv.port, { id: gate.id, decision: "approve" });
  expect(status).toBe(200);
  expect(json.ok).toBe(true);
  expect(calls).toHaveLength(1);
  const stored = await listOpsGates(tmpRepo);
  expect(stored[0]!.status).toBe("approved");
  expect(stored[0]!.decidedBy).toEqual({ by: "human", via: "cockpit" });
});