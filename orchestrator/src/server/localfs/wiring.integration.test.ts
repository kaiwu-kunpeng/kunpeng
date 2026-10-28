import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { startDashboard } from "../http.js";
import type { SpawnFn } from "../launch.js";

let tmpRepo: string | undefined;
let srv: { port: number; close: () => void } | undefined;

afterEach(() => {
  srv?.close();
  srv = undefined;
  if (tmpRepo) rmSync(tmpRepo, { recursive: true, force: true });
  tmpRepo = undefined;
});

const fakeSpawn = (() => ({ pid: 4242, unref() {} }) as ChildProcess) as SpawnFn;

test("localfs HTTP 路由端到端: enqueue 阻塞 → poll 取到 → result 解除", async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), "kp-localfs-wiring-"));
  srv = await startDashboard({ port: 0, repoRoot: tmpRepo, execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn: fakeSpawn });
  const base = `http://127.0.0.1:${srv.port}`;

  // enqueue 应阻塞，直到 result 才返回
  const enq = fetch(`${base}/api/localfs/enqueue?conv=c1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "read", path: "a.txt" }),
  }).then((r) => r.json() as Promise<Record<string, unknown>>);

  // 轮询直到取到 op
  let op: Record<string, unknown> | null = null;
  for (let i = 0; i < 100 && !op; i++) {
    const r = await fetch(`${base}/api/localfs/poll?conv=c1`);
    if (r.status === 200) op = (await r.json()) as Record<string, unknown>;
    else await new Promise((s) => setTimeout(s, 20));
  }
  expect(op).toBeTruthy();
  expect(op!.kind).toBe("read");
  expect(typeof op!.opId).toBe("string");

  // 别的 conv poll 不到
  const other = await fetch(`${base}/api/localfs/poll?conv=other`);
  expect(other.status).toBe(204);

  // result 解除 enqueue 阻塞
  await fetch(`${base}/api/localfs/result?conv=c1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ opId: op!.opId, ok: true, data: "HELLO" }),
  });
  const final = await enq;
  expect(final).toMatchObject({ ok: true, data: "HELLO" });
}, 15000);
