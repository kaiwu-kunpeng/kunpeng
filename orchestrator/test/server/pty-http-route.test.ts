import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboard } from "../../src/server/http.js";
import { PtySessionPool, type PtyHandle, type PtySpawnOpts } from "../../src/server/pty-pool.js";

class FakePty implements PtyHandle {
  dataCb?: (d: string) => void;
  exitCb?: (c: number) => void;
  killed = false;

  constructor(public opts: PtySpawnOpts) {}

  write() {}
  resize() {}
  onData(cb: (d: string) => void) { this.dataCb = cb; }
  onExit(cb: (c: number) => void) { this.exitCb = cb; }
  kill() { this.killed = true; }
}

let repo: string;
let stateDir: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-pty-http-repo-"));
  stateDir = mkdtempSync(join(tmpdir(), "kp-pty-http-state-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

function mkPool() {
  const ptys: FakePty[] = [];
  const factory = (opts: PtySpawnOpts) => {
    const pty = new FakePty(opts);
    ptys.push(pty);
    return pty;
  };
  const pool = new PtySessionPool({ factory, defaultShell: "/bin/zsh", now: (() => {
    let t = 1000;
    return () => t++;
  })() });
  return { pool, ptys };
}

async function jsonFetch(port: number, path: string, init: RequestInit = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  expect(res.headers.get("content-type")).toContain("application/json");
  return { status: res.status, body: await res.json() };
}

test("PTY REST route manages sessions in the injected pool", async () => {
  const { pool } = mkPool();
  const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir, ptyPool: pool });
  try {
    const created = await jsonFetch(srv.port, "/api/workspace/current/pty/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cols: 100, rows: 30 }),
    });
    expect(created.status).toBe(201);
    expect(created.body.ok).toBe(true);
    const sessionId = String(created.body.session.id);
    expect(sessionId).toBeTruthy();
    expect(created.body.session.cols).toBe(100);
    expect(created.body.session.rows).toBe(30);

    const listed = await jsonFetch(srv.port, "/api/workspace/current/pty/sessions");
    expect(listed.status).toBe(200);
    expect(listed.body.sessions.map((s: { id: string }) => s.id)).toContain(sessionId);

    const deleted = await jsonFetch(srv.port, `/api/workspace/current/pty/sessions/${sessionId}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true, killed: sessionId });

    const afterDelete = await jsonFetch(srv.port, `/api/workspace/current/pty/sessions/${sessionId}`);
    expect(afterDelete.status).toBe(200);
    expect(afterDelete.body.session.alive).toBe(false);

    const missingDelete = await jsonFetch(srv.port, "/api/workspace/current/pty/sessions/nope", {
      method: "DELETE",
    });
    expect(missingDelete.status).toBe(404);

    const other = await jsonFetch(srv.port, "/api/workspace/other/pty/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const otherId = String(other.body.session.id);
    const wrongWorkspaceDelete = await jsonFetch(srv.port, `/api/workspace/current/pty/sessions/${otherId}`, {
      method: "DELETE",
    });
    expect(wrongWorkspaceDelete.status).toBe(404);
  } finally {
    srv.close();
  }
});
