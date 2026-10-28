import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { startDashboard } from "../src/server/dashboard.js";
import type { SpawnFn } from "../src/server/launch.js";

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-launch-api-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fakeSpawn(calls: Array<{ file: string; args: readonly string[]; options: unknown }>): SpawnFn {
  return ((file, args, options) => {
    calls.push({ file, args: args ?? [], options });
    return { pid: 4321, unref() {} } as ChildProcess;
  }) as SpawnFn;
}

async function post(port: number, path: string, body: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.json() as Record<string, unknown>;
}

test("POST /api/run launches detached kunpeng run with argv array", async () => {
  const calls: Array<{ file: string; args: readonly string[]; options: unknown }> = [];
  const srv = await startDashboard({
    port: 0,
    repoRoot: dir,
    execPath: "/node",
    cliJs: "/cli.js",
    spawn: fakeSpawn(calls),
  });

  try {
    expect(srv.address).toBe("127.0.0.1");
    const json = await post(srv.port, "/api/run", { requirement: "做X" });

    expect(json).toMatchObject({ ok: true, pid: 4321 });
    expect(calls).toEqual([
      {
        file: "/node",
        args: ["/cli.js", "run", "做X", "--repo", dir],
        options: expect.objectContaining({
          cwd: dir,
          detached: true,
          stdio: ["ignore", expect.any(Number), expect.any(Number)],
          env: expect.objectContaining({ KUNPENG_FLOW_LOG: expect.stringContaining(join(dir, ".kunpeng", "cockpit", "logs")) }),
        }),
      },
    ]);
  } finally {
    srv.close();
  }
});

test("POST /api/run reports unknown project in multi-project mode", async () => {
  const stateDir = join(dir, "state");
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, "projects.json"), JSON.stringify({ projects: [] }), "utf8");
  const srv = await startDashboard({ port: 0, stateDir, execPath: "/node", cliJs: "/cli.js", spawn: fakeSpawn([]) });

  try {
    const unknown = await post(srv.port, "/api/run", { projectId: "missing", requirement: "做X" });
    expect(unknown.ok).toBe(false);
    expect(String(unknown.error)).toContain("未知项目 missing");
  } finally {
    srv.close();
  }
});

test("POST /api/run reports empty requirement", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: dir, execPath: "/node", cliJs: "/cli.js", spawn: fakeSpawn([]) });

  try {
    const empty = await post(srv.port, "/api/run", { requirement: "   " });
    expect(empty.ok).toBe(false);
    expect(String(empty.error)).toContain("requirement 不能为空");
  } finally {
    srv.close();
  }
});

test("POST /api/plan writes inline markdown and launches kunpeng plan", async () => {
  const calls: Array<{ file: string; args: readonly string[]; options: unknown }> = [];
  const srv = await startDashboard({
    port: 0,
    repoRoot: dir,
    execPath: "/node",
    cliJs: "/cli.js",
    spawn: fakeSpawn(calls),
  });

  try {
    const json = await post(srv.port, "/api/plan", { inlineMd: "# 方案\n\n## 阶段" });

    expect(json).toMatchObject({ ok: true, pid: 4321 });
    const planFile = String(json.planFile);
    expect(planFile).toContain(join(dir, ".kunpeng", "cockpit"));
    expect(await readFile(planFile, "utf8")).toBe("# 方案\n\n## 阶段");
    expect(calls[0]).toEqual({
      file: "/node",
      args: ["/cli.js", "plan", planFile, "--repo", dir],
      options: expect.objectContaining({
        cwd: dir,
        detached: true,
        stdio: ["ignore", expect.any(Number), expect.any(Number)],
        env: expect.objectContaining({ KUNPENG_FLOW_LOG: expect.stringContaining(join(dir, ".kunpeng", "cockpit", "logs")) }),
      }),
    });
  } finally {
    srv.close();
  }
});

test("POST /api/plan rejects empty plan input", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: dir, execPath: "/node", cliJs: "/cli.js", spawn: fakeSpawn([]) });

  try {
    const json = await post(srv.port, "/api/plan", { inlineMd: "   " });
    expect(json.ok).toBe(false);
    expect(String(json.error)).toContain("planPath 或 inlineMd 不能为空");
  } finally {
    srv.close();
  }
});

// --- 对抗审查 fix-forward ---

test("HIGH-1: inline plan 文件名带随机后缀，并发同毫秒也不撞名覆盖", async () => {
  const calls: Array<{ file: string; args: readonly string[]; options: unknown }> = [];
  const srv = await startDashboard({ port: 0, repoRoot: dir, execPath: "/node", cliJs: "/cli.js", spawn: fakeSpawn(calls) });
  try {
    // 文件名必须含随机段（仅时间戳在同毫秒并发下会撞）：plan-<ts36>-<hex>.md
    const a = await post(srv.port, "/api/plan", { inlineMd: "AAA" });
    expect(a.ok).toBe(true);
    expect(basename(String(a.planFile))).toMatch(/^plan-[0-9a-z]+-[0-9a-f]{6,}\.md$/);

    // 并发 5 个同时打（极可能落同一毫秒）→ 文件名全不同、5 份内容都在
    const reqs = ["c0", "c1", "c2", "c3", "c4"];
    const results = await Promise.all(reqs.map((m) => post(srv.port, "/api/plan", { inlineMd: m })));
    const files = results.map((r) => String(r.planFile));
    expect(new Set(files).size).toBe(reqs.length); // 全唯一
    for (let i = 0; i < reqs.length; i++) {
      expect(await readFile(files[i], "utf8")).toBe(reqs[i]); // 无覆盖
    }
  } finally {
    srv.close();
  }
});

test("MED-1: planPath 越界（穿越）被拒，绝不 spawn", async () => {
  const calls: Array<{ file: string; args: readonly string[]; options: unknown }> = [];
  const srv = await startDashboard({ port: 0, repoRoot: dir, execPath: "/node", cliJs: "/cli.js", spawn: fakeSpawn(calls) });
  try {
    const bad = await post(srv.port, "/api/plan", { planPath: "../../../../etc/passwd" });
    expect(bad.ok).toBe(false);
    expect(String(bad.error)).toContain("越界");
    expect(calls.length).toBe(0);
  } finally {
    srv.close();
  }
});

test("MED-1: repo 内的 planPath 被接受并解析到 repoRoot 下", async () => {
  const calls: Array<{ file: string; args: readonly string[]; options: unknown }> = [];
  await writeFile(join(dir, "myplan.md"), "# p", "utf8");
  const srv = await startDashboard({ port: 0, repoRoot: dir, execPath: "/node", cliJs: "/cli.js", spawn: fakeSpawn(calls) });
  try {
    const ok = await post(srv.port, "/api/plan", { planPath: "myplan.md" });
    expect(ok.ok).toBe(true);
    expect(calls[0].args).toEqual(["/cli.js", "plan", join(dir, "myplan.md"), "--repo", dir]);
  } finally {
    srv.close();
  }
});

test("MED-3: 路由精确匹配——/api/planets 不被当成 /api/plan 起进程", async () => {
  const calls: Array<{ file: string; args: readonly string[]; options: unknown }> = [];
  const srv = await startDashboard({ port: 0, repoRoot: dir, execPath: "/node", cliJs: "/cli.js", spawn: fakeSpawn(calls) });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/planets`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inlineMd: "x" }),
    });
    const text = await res.text();
    expect(calls.length).toBe(0); // 没被当 plan 起进程
    expect(text.trimStart().startsWith("{")).toBe(false); // 落到 HTML 页，非 {ok} JSON
  } finally {
    srv.close();
  }
});
