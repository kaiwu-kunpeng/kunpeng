import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { FlowTracker, type FlowState } from "../src/runtime/flowstate.js";
import { startDashboard } from "../src/server/http.js";
import type { SpawnFn } from "../src/server/launch.js";

let repo: string;

const post = async (port: number, path: string, b: unknown) =>
  (await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  })).json();

beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-a2-")); });
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("/api/stop 非运行流被拒、运行流可落 stopped（pid 不存在时仍收敛）", async () => {
  const t = new FlowTracker(join(repo, ".kunpeng", "state"));
  await t.start("frun", "x");
  const p = join(repo, ".kunpeng", "state", "frun.json");
  const running = JSON.parse(readFileSync(p, "utf8")) as FlowState;
  writeFileSync(p, JSON.stringify({ ...running, pid: 99999999 }, null, 2));
  await t.start("fdone", "y");
  await t.finish("fdone", "verified");

  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    expect((await post(srv.port, "/api/stop", { projectId: "current", flowId: "fdone" })).ok).toBe(false);
    expect((await post(srv.port, "/api/stop", { projectId: "current", flowId: "frun" })).ok).toBe(true);
    expect((await t.read("frun"))?.status).toBe("stopped");
  } finally {
    srv.close();
  }
});

test("/api/rerun run 流用 requirement、plan 流缺 planRef 报错", async () => {
  const calls: { file: string; args: string[]; options: unknown }[] = [];
  const fakeSpawn = ((file: string, args: string[], options: unknown) => {
    calls.push({ file, args, options });
    return { pid: 7, unref() {} } as ReturnType<SpawnFn>;
  }) as SpawnFn;
  const t = new FlowTracker(join(repo, ".kunpeng", "state"));
  await t.start("frun", "重跑我");
  await t.markStopped("frun");
  await t.start("fplan", "plan child", { planId: "plan-old", phase: 0 });
  await new ArtifactStore(join(repo, ".kunpeng", "artifacts")).write({
    kind: "plan",
    id: "plan-old",
    status: "in-progress",
    body: "旧方案",
    meta: {},
  });

  const srv = await startDashboard({ port: 0, repoRoot: repo, execPath: "/node", cliJs: "/cli.js", spawn: fakeSpawn });
  try {
    const r = await post(srv.port, "/api/rerun", { projectId: "current", flowId: "frun" });
    expect(r.ok).toBe(true);
    expect(r.pid).toBe(7);
    expect(typeof r.logPath).toBe("string");
    expect(calls[0].args).toEqual(["/cli.js", "run", "重跑我", "--repo", repo]);

    const oldPlan = await post(srv.port, "/api/rerun", { projectId: "current", flowId: "fplan" });
    expect(oldPlan.ok).toBe(false);
    expect(String(oldPlan.error)).toContain("未记录 planRef");
    expect(calls).toHaveLength(1);
  } finally {
    srv.close();
  }
});

test("/api/edit-proposal 改 body + /api/proposal-body 读回", async () => {
  const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  await store.write({ kind: "proposal", id: "p1", status: "draft", body: "旧内容", meta: { keep: true } });
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    expect((await post(srv.port, "/api/edit-proposal", { projectId: "current", id: "p1", body: "新内容" })).ok).toBe(true);
    const got = await (await fetch(`http://127.0.0.1:${srv.port}/api/proposal-body?projectId=current&id=p1`)).json();
    expect(got.body).toContain("新内容");
    const saved = await store.read("p1");
    expect(saved.status).toBe("draft");
    expect(saved.kind).toBe("proposal");
    expect(saved.meta).toEqual({ keep: true });
  } finally {
    srv.close();
  }
});

test("/api/edit-proposal #1 治本：body 以 --- 开头能正确存读、不丢失", async () => {
  const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  await store.write({ kind: "proposal", id: "p3", status: "draft", body: "原始正文", meta: {} });
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const r = await post(srv.port, "/api/edit-proposal", { projectId: "current", id: "p3", body: "---\n\n# 标题\n\n正文很重要" });
    expect(r.ok).toBe(true);                                        // 治本后前导 --- 能正常存
    const got = await (await fetch(`http://127.0.0.1:${srv.port}/api/proposal-body?projectId=current&id=p3`)).json();
    expect(got.body).toContain("# 标题");
    expect(got.body).toContain("正文很重要");                        // 正文完整、零丢失
    expect(got.body.trimStart().startsWith("---")).toBe(true);      // 前导 --- 保留
  } finally { srv.close(); }
});

test("/api/edit-proposal #3 非 draft 提案拒绝编辑", async () => {
  const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  await store.write({ kind: "proposal", id: "p4", status: "approved", body: "已批准", meta: {} });
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const r = await post(srv.port, "/api/edit-proposal", { projectId: "current", id: "p4", body: "想改" });
    expect(r.ok).toBe(false);
    expect((await store.read("p4")).body).toContain("已批准");  // 未被改动
  } finally { srv.close(); }
});

test("/api/edit-proposal #LOW-1 正文前导空白（缩进首行）会被吞 → fail-loud 不静默成功", async () => {
  const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  await store.write({ kind: "proposal", id: "p5", status: "draft", body: "原文", meta: {} });
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const r = await post(srv.port, "/api/edit-proposal", { projectId: "current", id: "p5", body: "    缩进首行\n第二行" });
    expect(r.ok).toBe(false);                                  // 前导空白会被 trimStart 吞 → fail-loud（不静默 ok）
    expect((await store.read("p5")).body).toContain("原文");   // 回滚保原内容
  } finally { srv.close(); }
});
