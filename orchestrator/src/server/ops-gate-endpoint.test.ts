import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { startDashboard } from "./http.js";
import type { SpawnFn } from "./launch.js";
import { createOpsGate, listOpsGates } from "../loop/ops-gate.js";

let tmpRepo: string | undefined;
let srv: { port: number; close: () => void } | undefined;

afterEach(() => {
  srv?.close();
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

async function getGates(port: number): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${port}/api/ops-gates`);
  return await res.json() as Record<string, unknown>;
}

async function decide(
  port: number,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/ops-gate-decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

test("GET /api/ops-gates 列出存储中的门", async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), "kp-ops-gates-api-"));
  await createOpsGate(tmpRepo, { projectId: "x", playbookId: "pb1", loopId: "loop-a", reason: "review 门" }, 1000);
  const { spawn } = spawnRecorder();
  srv = await startDashboard({ port: 0, repoRoot: tmpRepo, execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn });

  const json = await getGates(srv.port);
  const gates = json.gates as Array<Record<string, unknown>>;
  expect(Array.isArray(gates)).toBe(true);
  expect(gates).toHaveLength(1);
  expect(gates[0].playbookId).toBe("pb1");
  expect(gates[0].status).toBe("pending");
});

test("GET /api/ops-gates 空存储返回空数组", async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), "kp-ops-gates-empty-"));
  const { spawn } = spawnRecorder();
  srv = await startDashboard({ port: 0, repoRoot: tmpRepo, execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn });

  const json = await getGates(srv.port);
  expect(json.gates).toEqual([]);
});

test("POST approve 有 loopId：置 approved 且用 loop run argv 起跑，返回 pid", async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), "kp-ops-gates-api-"));
  const gate = await createOpsGate(tmpRepo, { projectId: "x", playbookId: "pb1", loopId: "loop-a", reason: "r" }, 1000);
  const { calls, spawn } = spawnRecorder();
  srv = await startDashboard({ port: 0, repoRoot: tmpRepo, execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn });

  const { status, json } = await decide(srv.port, { id: gate.id, decision: "approve" });
  expect(status).toBe(200);
  expect(json.ok).toBe(true);
  expect(json.pid).toBe(4242);
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toEqual(["/x/cli.js", "loop", "run", "--id", "loop-a", "--repo", tmpRepo]);
  const stored = await listOpsGates(tmpRepo);
  expect(stored[0].status).toBe("approved");
});

test("POST approve 无 loopId：只置 approved 不起跑", async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), "kp-ops-gates-api-"));
  const gate = await createOpsGate(tmpRepo, { projectId: "x", playbookId: "pb1", loopId: "", reason: "r" }, 1000);
  const { calls, spawn } = spawnRecorder();
  srv = await startDashboard({ port: 0, repoRoot: tmpRepo, execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn });

  const { json } = await decide(srv.port, { id: gate.id, decision: "approve" });
  expect(json.ok).toBe(true);
  expect(json.pid).toBeUndefined();
  expect(calls).toEqual([]);
  const stored = await listOpsGates(tmpRepo);
  expect(stored[0].status).toBe("approved");
});

test("POST reject：置 rejected 不起跑", async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), "kp-ops-gates-api-"));
  const gate = await createOpsGate(tmpRepo, { projectId: "x", playbookId: "pb1", loopId: "loop-a", reason: "r" }, 1000);
  const { calls, spawn } = spawnRecorder();
  srv = await startDashboard({ port: 0, repoRoot: tmpRepo, execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn });

  const { json } = await decide(srv.port, { id: gate.id, decision: "reject" });
  expect(json.ok).toBe(true);
  expect(calls).toEqual([]);
  const stored = await listOpsGates(tmpRepo);
  expect(stored[0].status).toBe("rejected");
});

test("POST 未知/已决 id：400 且不起跑", async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), "kp-ops-gates-api-"));
  const { calls, spawn } = spawnRecorder();
  srv = await startDashboard({ port: 0, repoRoot: tmpRepo, execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn });

  const { status, json } = await decide(srv.port, { id: "opsgate-nope", decision: "approve" });
  expect(status).toBe(400);
  expect(json.ok).toBe(false);
  expect(typeof json.error).toBe("string");
  expect(calls).toEqual([]);
});