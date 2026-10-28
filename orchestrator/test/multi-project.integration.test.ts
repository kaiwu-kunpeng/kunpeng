import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { registerProject } from "../src/project/registry.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { collectMultiState } from "../src/server/state.js";
import { startDashboard } from "../src/server/http.js";
import { ArtifactStore } from "../src/artifacts/store.js";

type StateResponseProject = { id: string; state: { flows: Array<{ flowId: string }> } };
type StateResponse = { projects: StateResponseProject[] };

// repo 目录名固定 alpha/beta（id 来自目录名）。
let state: string, parentA: string, parentB: string, repoA: string, repoB: string;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "kp-state-"));
  parentA = mkdtempSync(join(tmpdir(), "kp-pa-")); repoA = join(parentA, "alpha"); mkdirSync(repoA);
  parentB = mkdtempSync(join(tmpdir(), "kp-pb-")); repoB = join(parentB, "beta"); mkdirSync(repoB);
});
afterEach(() => [state, parentA, parentB].forEach((d) => rmSync(d, { recursive: true, force: true })));

test("collectMultiState returns one snapshot per registered project, flows not crossing", async () => {
  await registerProject({ repoPath: repoA, name: "Alpha", stateDir: state, now: 1 });
  await registerProject({ repoPath: repoB, name: "Beta", stateDir: state, now: 2 });
  await new FlowTracker(join(repoA, ".kunpeng", "state")).start("a1", "do A");
  await new FlowTracker(join(repoB, ".kunpeng", "state")).start("b1", "do B");

  const snaps = await collectMultiState(state);
  expect(snaps).toHaveLength(2);
  const a = snaps.find((s) => s.id === "alpha")!;
  const b = snaps.find((s) => s.id === "beta")!;
  expect(a.name).toBe("Alpha");
  const aFlows = a.state.flows.map((f) => f.flowId);
  expect(aFlows).toContain("a1");
  expect(aFlows).not.toContain("b1");
  expect(b.state.flows.map((f) => f.flowId)).toContain("b1");
});

test("collectMultiState returns [] when no projects registered", async () => {
  expect(await collectMultiState(state)).toEqual([]);
});

test("collectMultiState 容错坏 artifact：坏档被跳过，健康项目不受影响、该项目自身也照常返回", async () => {
  await registerProject({ repoPath: repoA, name: "Alpha", stateDir: state, now: 1 });
  await registerProject({ repoPath: repoB, name: "Beta", stateDir: state, now: 2 });

  // alpha: healthy flow
  await new FlowTracker(join(repoA, ".kunpeng", "state")).start("a1", "do A");

  // beta: 一个 schema 外的坏 artifact（gray-matter 能解析但 Artifact.parse(zod) 拒绝）。
  // 曾导致 collectState 抛错 → 多项目整盘空白；现在 ArtifactStore.list 跳过坏档、collectState 容错。
  const betaArtDir = join(repoB, ".kunpeng", "artifacts");
  mkdirSync(betaArtDir, { recursive: true });
  writeFileSync(join(betaArtDir, "bad.md"), "---\nfoo: bar\n---\nbody", "utf8");

  const snaps = await collectMultiState(state);
  expect(snaps).toHaveLength(2);

  const a = snaps.find((s) => s.id === "alpha")!;
  const b = snaps.find((s) => s.id === "beta")!;

  // healthy project survives intact
  expect(a.error).toBeUndefined();
  expect(a.state.flows.map((f) => f.flowId)).toContain("a1");

  // 坏 artifact 被容错跳过：beta 不再整项目失败，照常返回（无 error、无有效 flow）
  expect(b.error).toBeUndefined();
  expect(b.state.flows).toHaveLength(0);
});

test("startDashboard multi-mode /api/state returns one entry per project", async () => {
  await registerProject({ repoPath: repoA, name: "Alpha", stateDir: state, now: 1 });
  await registerProject({ repoPath: repoB, name: "Beta", stateDir: state, now: 2 });
  await new FlowTracker(join(repoA, ".kunpeng", "state")).start("a1", "do A");
  const srv = await startDashboard({ port: 0, stateDir: state });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/state`);
    const data = (await res.json()) as StateResponse;
    expect(data.projects).toHaveLength(2);
    const a = data.projects.find((p) => p.id === "alpha")!;
    expect(a.state.flows.map((f) => f.flowId)).toContain("a1");
  } finally { srv.close(); }
});

test("startDashboard single-mode (repoRoot) returns exactly one project, ignores registry", async () => {
  await registerProject({ repoPath: repoA, name: "Alpha", stateDir: state, now: 1 });
  await registerProject({ repoPath: repoB, name: "Beta", stateDir: state, now: 2 });
  // 单项目模式：只看 repoA（即便注册表里有两项）。repoA 未注册 project.json 时回退用 basename。
  const srv = await startDashboard({ port: 0, repoRoot: repoA });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/state`);
    const data = await res.json();
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].repoPath).toBe(repoA);
  } finally { srv.close(); }
});

// Test 1 — 未知 projectId：两个 mutating 端点都返回 JSON 错误（ok:false），而不是 500。
test("/api/merge and /api/approve return JSON error (not 500) for unknown projectId", async () => {
  const srv = await startDashboard({ port: 0, stateDir: state });
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const mres = await fetch(`${base}/api/merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "nope", flowId: "x" }),
    });
    expect(mres.status).toBe(200);
    const mbody = await mres.json();
    expect(mbody.ok).toBe(false);
    expect(String(mbody.error)).toContain("未知项目");

    const ares = await fetch(`${base}/api/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "nope", id: "y" }),
    });
    expect(ares.status).toBe(200);
    const abody = await ares.json();
    expect(abody.ok).toBe(false);
    expect(String(abody.error)).toContain("未知项目");
  } finally { srv.close(); }
});

// Test 2 — /api/approve happy path：按 projectId 路由到正确项目，并真正推进 artifact 状态。
// transition 仅允许 draft -> approved（见 types.ts TRANSITIONS），故起始 kind=proposal, status=draft。
test("/api/approve happy path routes to the right project and approves the artifact", async () => {
  await registerProject({ repoPath: repoA, name: "Alpha", stateDir: state, now: 1 });
  const store = new ArtifactStore(join(repoA, ".kunpeng", "artifacts"));
  await store.write({ kind: "proposal", id: "p1", status: "draft", body: "提案正文", meta: {} });

  const srv = await startDashboard({ port: 0, stateDir: state });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "alpha", id: "p1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  } finally { srv.close(); }

  const after = await store.read("p1");
  expect(after.status).toBe("approved");
});

// Test 3 — /api/merge happy path：真 git 仓库，临时 worktree 合并按 projectId 路由，不扰动共享工作树。
test("/api/merge happy path merges kp/<flowId> into target via worktree, by projectId, without disturbing the working tree", async () => {
  const g = simpleGit(repoA);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repoA, "base.txt"), "base\n");
  await g.add(".");
  await g.commit("init");
  const def = (await g.branchLocal()).current;

  await g.checkoutLocalBranch("kp/m1");
  writeFileSync(join(repoA, "feature.txt"), "from branch\n");
  await g.add(".");
  await g.commit("feature");
  await g.checkout(def);

  // 合并前：default 分支上还看不到 feature.txt（已切回 default，工作树是干净的 base）。
  expect(existsSync(join(repoA, "feature.txt"))).toBe(false);

  await registerProject({ repoPath: repoA, name: "Alpha", stateDir: state, now: 1 });

  const srv = await startDashboard({ port: 0, stateDir: state });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "alpha", flowId: "m1", target: def }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  } finally { srv.close(); }

  // 主工作树正停在 default(=合并目标)：safeMerge 改为「直接在主树合并」，所以工作树与 ref 一致地更新——
  // feature.txt 落到磁盘（这才正确；旧的临时-worktree 合入当前分支会令工作树与 ref 不一致、酿幽灵删除）。
  // 注：当主树在【别的】分支时（如 demo-travel 的 verify/180-cities 合入 main），仍走临时 worktree、不夺工作树。
  const g2 = simpleGit(repoA);
  expect((await g2.branchLocal()).current).toBe(def);
  expect(existsSync(join(repoA, "feature.txt"))).toBe(true);
  expect((await g2.status()).deleted).toHaveLength(0);   // 工作树与 ref 一致，无幽灵删除

  // 但 default 分支的 HEAD（git 历史/树）已经包含 kp/m1 的合并：
  // 1) 出现 --no-ff 合并提交；2) feature.txt 存在于 def HEAD 的树里且内容正确。
  const log = await g2.log();
  expect(log.all.some((c) => /Merge branch 'kp\/m1'/.test(c.message))).toBe(true);
  const tree = await g2.raw(["ls-tree", "-r", "--name-only", def]);
  expect(tree.split("\n")).toContain("feature.txt");
  const shown = await g2.raw(["show", `${def}:feature.txt`]);
  expect(shown).toContain("from branch");
});

// Test 4 — 崩溃恢复：上一次合并进程被杀后残留 .kunpeng/merge-tmp 已注册 worktree，
// /api/merge 应在 worktree add 前 best-effort 清理它，使本次合并仍成功（ok:true）。
// 没有这个修复，残留 worktree 会让 worktree add 报 fatal: already exists，此后每次合并永久卡死。
test("/api/merge recovers from a stale merge-tmp worktree left by a crashed prior merge", async () => {
  const g = simpleGit(repoA);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repoA, "base.txt"), "base\n");
  await g.add(".");
  await g.commit("init");
  const def = (await g.branchLocal()).current;

  await g.checkoutLocalBranch("kp/m1");
  writeFileSync(join(repoA, "feature.txt"), "from branch\n");
  await g.add(".");
  await g.commit("feature");
  await g.checkout(def);

  await registerProject({ repoPath: repoA, name: "Alpha", stateDir: state, now: 1 });

  // 模拟崩溃的上一次合并：在 merge-tmp 路径留一个已注册的残留 worktree（add 后、remove 前被杀）。
  await g.raw(["worktree", "add", "-f", join(repoA, ".kunpeng", "merge-tmp"), def]);

  const srv = await startDashboard({ port: 0, stateDir: state });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "alpha", flowId: "m1", target: def }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // 预清理移除了残留 worktree → 本次合并成功。无修复时这里会是 ok:false + "already exists"。
    expect(body.ok).toBe(true);
  } finally { srv.close(); }

  // 合并确实生效：def HEAD 出现 --no-ff 合并提交，且包含 feature.txt。
  const g2 = simpleGit(repoA);
  const log = await g2.log();
  expect(log.all.some((c) => /Merge branch 'kp\/m1'/.test(c.message))).toBe(true);
  const tree = await g2.raw(["ls-tree", "-r", "--name-only", def]);
  expect(tree.split("\n")).toContain("feature.txt");
});
