import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboard } from "../src/server/http.js";
import type { SpawnFn } from "../src/server/launch.js";

let repo: string;

beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-dcg-")); });
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("POST /api/design-codegen detached 拉起 kunpeng design-codegen", async () => {
  const calls: { f: string; a: string[]; o: unknown }[] = [];
  const fakeSpawn = ((f: string, a: string[], o: unknown) => {
    calls.push({ f, a, o });
    return { pid: 8, unref() {} } as ReturnType<SpawnFn>;
  }) as SpawnFn;
  const srv = await startDashboard({ port: 0, repoRoot: repo, execPath: "/node", cliJs: "/cli.js", spawn: fakeSpawn });
  try {
    const r = await (await fetch(`http://127.0.0.1:${srv.port}/api/design-codegen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "current" }),
    })).json();
    expect(r.ok).toBe(true);
    expect(r.pid).toBe(8);
    expect(calls[0].a).toEqual(["/cli.js", "design-codegen", "--repo", repo]);
  } finally {
    srv.close();
  }
});
