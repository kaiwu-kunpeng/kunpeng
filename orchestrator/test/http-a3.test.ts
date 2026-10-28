import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { startDashboard } from "../src/server/http.js";

let repo: string;

const get = async (port: number, path: string) => (await fetch(`http://127.0.0.1:${port}${path}`)).json();
const post = async (port: number, path: string, b: unknown) =>
  (await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  })).json();

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-a3-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t").addConfig("user.name", "t");
  await g.checkoutLocalBranch("main");
  writeFileSync(join(repo, "a.txt"), "x");
  await g.add("a.txt");
  await g.commit("init");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("/api/flow-log 读 flow 的 logPath 尾部、越界拒绝、旧流无日志", async () => {
  const logsDir = join(repo, ".kunpeng", "cockpit", "logs");
  mkdirSync(logsDir, { recursive: true });
  const logPath = join(logsDir, "run-x.log");
  writeFileSync(logPath, "HELLO_LOG_LINE");
  const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
  await tracker.start("f1", "r", { logPath });
  await tracker.start("f2", "r");
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const r1 = await get(srv.port, "/api/flow-log?projectId=current&flowId=f1");
    expect(r1.ok).toBe(true);
    expect(r1.log).toContain("HELLO_LOG_LINE");
    expect((await get(srv.port, "/api/flow-log?projectId=current&flowId=f2")).ok).toBe(false);
  } finally {
    srv.close();
  }
});

test("/api/flow-log #MED 软链穿越被 realpath 挡住、不泄漏外部文件", async () => {
  const { symlinkSync } = await import("node:fs");
  const logsDir = join(repo, ".kunpeng", "cockpit", "logs");
  mkdirSync(logsDir, { recursive: true });
  const secret = join(repo, "SECRET.txt"); writeFileSync(secret, "LEAKED_VIA_SYMLINK");
  symlinkSync(secret, join(logsDir, "evil.log"));            // logs 内软链指向外部文件
  const t = new FlowTracker(join(repo, ".kunpeng", "state"));
  await t.start("sym", "r", { logPath: join(logsDir, "evil.log") });
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const r = await get(srv.port, "/api/flow-log?projectId=current&flowId=sym");
    expect(r.ok).toBe(false);                                // realpath 解析后越界 → 拒绝
    expect(JSON.stringify(r)).not.toContain("LEAKED");
  } finally { srv.close(); }
});

test("/api/save-plan + /api/plans + /api/plan-file 往返", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    expect((await post(srv.port, "/api/save-plan", { projectId: "current", name: "我的方案", body: "# 方案\n内容" })).ok).toBe(true);
    const list = await get(srv.port, "/api/plans?projectId=current");
    expect(list.plans).toContain("我的方案.md");
    const file = await get(srv.port, "/api/plan-file?projectId=current&name=我的方案.md");
    expect(file.body).toContain("# 方案");
    expect((await get(srv.port, "/api/plan-file?projectId=current&name=../../etc/passwd")).ok).toBe(false);
  } finally {
    srv.close();
  }
});

test("/api/gc 跑 runGc 返回计数", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const r = await post(srv.port, "/api/gc", { projectId: "current", dryRun: true });
    expect(r.ok).toBe(true);
    expect(typeof r.logsDeleted).toBe("number");
    expect(Array.isArray(r.deleted)).toBe(true);
  } finally {
    srv.close();
  }
});
