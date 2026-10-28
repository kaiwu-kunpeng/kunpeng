import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { startDashboard } from "./http.js";
import type { SpawnFn } from "./launch.js";

let tmpRepo: string | undefined;
let srv: { port: number; close: () => void } | undefined;

afterEach(() => {
  srv?.close();
  srv = undefined;
  if (tmpRepo) rmSync(tmpRepo, { recursive: true, force: true });
  tmpRepo = undefined;
});

async function post(port: number, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${port}/api/loop-run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.json() as Record<string, unknown>;
}

test("POST /api/loop-run starts one loop wave with loop run argv", async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), "kp-loop-run-api-"));
  const calls: { cmd: string; args: string[] }[] = [];
  const fakeSpawn = ((cmd: string, args?: readonly string[]) => {
    calls.push({ cmd, args: [...(args ?? [])] });
    return { pid: 4242, unref() {} } as ChildProcess;
  }) as SpawnFn;
  srv = await startDashboard({ port: 0, repoRoot: tmpRepo, execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn: fakeSpawn });

  const json = await post(srv.port, { projectId: "x", loopId: "acme-catalog" });

  expect(json.ok).toBe(true);
  expect(json.pid).toBe(4242);
  expect(calls[0].args).toEqual(["/x/cli.js", "loop", "run", "--id", "acme-catalog", "--repo", tmpRepo]);
});

test("POST /api/loop-run rejects missing loopId without spawning", async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), "kp-loop-run-api-"));
  const calls: { cmd: string; args: string[] }[] = [];
  const fakeSpawn = ((cmd: string, args?: readonly string[]) => {
    calls.push({ cmd, args: [...(args ?? [])] });
    return { pid: 4242, unref() {} } as ChildProcess;
  }) as SpawnFn;
  srv = await startDashboard({ port: 0, repoRoot: tmpRepo, execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn: fakeSpawn });

  const json = await post(srv.port, { projectId: "x" });

  expect(json.ok).toBe(false);
  expect(String(json.error)).toContain("缺 loopId");
  expect(calls).toEqual([]);
});
