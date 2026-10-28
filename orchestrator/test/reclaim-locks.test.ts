import { afterEach, beforeEach, expect, test } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { Workspace, reclaimReposBestEffort } from "../src/git/workspace.js";

let repo: string;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-repo-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

function lockPath(flowId: string): string {
  return join(repo, ".kunpeng", "locks", `${flowId}.lock`);
}

function metaPath(flowId: string): string {
  return join(lockPath(flowId), "meta.json");
}

function writeMeta(flowId: string, meta: { host?: string; pid?: number } = {}): void {
  mkdirSync(lockPath(flowId), { recursive: true });
  writeFileSync(metaPath(flowId), `${JSON.stringify({
    schema: "kunpeng-lock/v1",
    pid: meta.pid ?? 999_999_999,
    host: meta.host ?? hostname(),
    flowId,
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

test("acquire writes lock owner meta", async () => {
  const ws = new Workspace(repo);
  await ws.acquire("meta");

  const meta = JSON.parse(readFileSync(metaPath("meta"), "utf8")) as Record<string, unknown>;
  expect(meta.schema).toBe("kunpeng-lock/v1");
  expect(meta.pid).toBe(process.pid);
  expect(meta.host).toBe(hostname());
  expect(meta.flowId).toBe("meta");
  expect(Date.parse(String(meta.startedAt))).not.toBeNaN();

  await ws.rollback("meta");
});

test("dead lock is reclaimed, archived, and can be acquired again", async () => {
  const flowId = "dead";
  const ws = new Workspace(repo);
  const flow = await ws.acquire(flowId);
  writeFileSync(join(flow.path, "survive.txt"), "keep me\n");
  await ws.commit(flowId, "kp(dead): survive");

  const result = await new Workspace(repo).reclaimDeadLocks({ isAlive: () => false });
  expect(result.reclaimed).toContain(flowId);
  expect(existsSync(lockPath(flowId))).toBe(false);
  expect(existsSync(flow.path)).toBe(false);

  const branches = await simpleGit(repo).branchLocal();
  expect(branches.all).not.toContain(`kp/${flowId}`);
  const stale = branches.all.find((b) => b.startsWith(`kp-stale/${flowId}-`));
  expect(stale).toBeDefined();
  const log = await simpleGit(repo).raw(["log", "--oneline", stale!]);
  expect(log).toContain("kp(dead): survive");

  const reacquired = await new Workspace(repo).acquire(flowId);
  expect(reacquired.branch).toBe(`kp/${flowId}`);
  await new Workspace(repo).reclaimDeadLocks({ isAlive: () => false });
});

test("live lock is skipped and still blocks acquire", async () => {
  const flowId = "live";
  await new Workspace(repo).acquire(flowId);

  const result = await new Workspace(repo).reclaimDeadLocks({ isAlive: () => true });
  expect(result.skipped).toContain(flowId);
  expect(existsSync(lockPath(flowId))).toBe(true);
  await expect(new Workspace(repo).acquire(flowId)).rejects.toThrow(/already held/);

  await new Workspace(repo).reclaimDeadLocks({ isAlive: () => false });
});

test("cross-host lock is skipped", async () => {
  const flowId = "other-host";
  writeMeta(flowId, { host: "some-other-host", pid: 123 });

  const result = await new Workspace(repo).reclaimDeadLocks({ isAlive: () => false });
  expect(result.skipped).toContain(flowId);
  expect(existsSync(lockPath(flowId))).toBe(true);
});

test("young lock without meta is skipped", async () => {
  const flowId = "young-no-meta";
  mkdirSync(lockPath(flowId), { recursive: true });

  const result = await new Workspace(repo).reclaimDeadLocks({ now: () => Date.now() });
  expect(result.skipped).toContain(flowId);
  expect(existsSync(lockPath(flowId))).toBe(true);
});

test("old lock without meta is reclaimed", async () => {
  const flowId = "old-no-meta";
  mkdirSync(lockPath(flowId), { recursive: true });

  const result = await new Workspace(repo).reclaimDeadLocks({ now: () => Date.now() + 3_600_000 });
  expect(result.reclaimed).toContain(flowId);
  expect(existsSync(lockPath(flowId))).toBe(false);
});

test("orphan lock without worktree or branch is reclaimed", async () => {
  const flowId = "orphan";
  writeMeta(flowId);

  const result = await new Workspace(repo).reclaimDeadLocks({ isAlive: () => false });
  expect(result.reclaimed).toContain(flowId);
  expect(existsSync(lockPath(flowId))).toBe(false);
});

// --- 对抗审查 fix-forward 复核 ---

test("B1: repeated crash+reclaim of same flowId archives uniquely; re-acquire keeps working", async () => {
  const flowId = "dup";
  // 第一次崩溃留锁+分支+commit
  const ws1 = new Workspace(repo);
  const f1 = await ws1.acquire(flowId);
  writeFileSync(join(f1.path, "a.txt"), "1\n");
  await ws1.commit(flowId, "kp(dup): c1");
  // 注入同一时钟 now=1000：旧实现归档名只用 now → 第二轮会撞名
  const r1 = await new Workspace(repo).reclaimDeadLocks({ isAlive: () => false, now: () => 1000 });
  expect(r1.reclaimed).toContain(flowId);

  // 同 flowId 重跑后再次崩溃
  const ws2 = new Workspace(repo);
  const f2 = await ws2.acquire(flowId);
  writeFileSync(join(f2.path, "b.txt"), "2\n");
  await ws2.commit(flowId, "kp(dup): c2");
  const r2 = await new Workspace(repo).reclaimDeadLocks({ isAlive: () => false, now: () => 1000 });
  expect(r2.reclaimed).toContain(flowId);

  // kp/<id> 必须被归档掉（不残留），两份归档分支都在，再 acquire 能成功
  const branches = await simpleGit(repo).branchLocal();
  expect(branches.all).not.toContain(`kp/${flowId}`);
  expect(branches.all.filter((b) => b.startsWith(`kp-stale/${flowId}-`)).length).toBe(2);
  expect(existsSync(lockPath(flowId))).toBe(false);
  const reacq = await new Workspace(repo).acquire(flowId);
  expect(reacq.branch).toBe(`kp/${flowId}`);
  await new Workspace(repo).reclaimDeadLocks({ isAlive: () => false });
});

test("B2: a lock whose removal fails does not abort the whole sweep (no throw)", async () => {
  const locksRoot = join(repo, ".kunpeng", "locks");
  writeMeta("aaa");
  writeMeta("zzz");
  chmodSync(locksRoot, 0o555); // 只读父目录 → 子锁 unlink 失败(EACCES)
  let threw = false;
  let result;
  try {
    result = await new Workspace(repo).reclaimDeadLocks({ isAlive: () => false });
  } catch {
    threw = true;
  }
  chmodSync(locksRoot, 0o755); // 还原供 afterEach 清理
  expect(threw).toBe(false); // sweep 绝不能因单锁失败而抛断
  // 两个锁都被尝试到（都没能删除 → 都在 skipped），证明 zzz 没被 aaa 的失败带崩
  expect(result?.skipped).toContain("aaa");
  expect(result?.skipped).toContain("zzz");
  expect(existsSync(lockPath("aaa"))).toBe(true);
  expect(existsSync(lockPath("zzz"))).toBe(true);
});

test("H1: no-meta lock younger than the (conservative) grace is skipped", async () => {
  const flowId = "midaged-no-meta";
  mkdirSync(lockPath(flowId), { recursive: true });
  // 90s 龄：旧 60s grace 会误清；新的保守 grace 下应跳过
  const result = await new Workspace(repo).reclaimDeadLocks({ now: () => Date.now() + 90_000 });
  expect(result.skipped).toContain(flowId);
  expect(existsSync(lockPath(flowId))).toBe(true);
});

test("L1: lock with invalid pid<=0 is treated as dead (default isAlive)", async () => {
  const flowId = "badpid";
  writeMeta(flowId, { pid: 0 });
  const result = await new Workspace(repo).reclaimDeadLocks(); // 走默认 isAlive
  expect(result.reclaimed).toContain(flowId);
  expect(existsSync(lockPath(flowId))).toBe(false);
});

test("B3-1: reclaimReposBestEffort skips nonexistent/non-git repos without throwing, still reclaims good ones", async () => {
  // 真仓里种一个死锁；外加一个不存在的目录（new Workspace 会同步抛 simple-git 错）
  writeMeta("startup-dead");
  let threw = false;
  try {
    await reclaimReposBestEffort(["/no/such/dir/xyz123", repo]);
  } catch {
    threw = true;
  }
  expect(threw).toBe(false); // 坏 repo 绝不能让整轮（及 serve 启动）崩
  expect(existsSync(lockPath("startup-dead"))).toBe(false); // 好 repo 的死锁照清
});
