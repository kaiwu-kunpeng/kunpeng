import { mkdir, readFile, rm, readdir, stat, symlink, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import { join, basename } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { snapshotCheckpoint, listCheckpoints, type CkptResult } from "../runtime/flow-checkpoint.js";
import { removeFlowTmpDir } from "../runtime/flow-tmp.js";
import { isProcessAlive } from "../util/liveness.js";
import { rollbackPolicy } from "./rollback-policy.js";

export interface Flow { id: string; branch: string; path: string; }

interface LockMeta {
  schema: "kunpeng-lock/v1";
  pid: number;
  host: string;
  flowId: string;
  startedAt: string;
}

export interface ReclaimDeadLocksOptions {
  now?: () => number;
  isAlive?: (pid: number) => boolean;
  graceMs?: number;
}

export interface ReclaimDeadLocksResult {
  reclaimed: string[];
  skipped: string[];
}

const LOCK_SCHEMA = "kunpeng-lock/v1";
// 无 meta 锁（旧版/正卡在 acquire mkdir→写meta 窗口的活锁）的保守清扫宽限：远大于正常写 meta 的微秒级耗时，
// 避免在慢盘/断点/负载尖峰下把一个活进程刚 mkdir、尚未写 meta 的锁误判为陈旧而误清（破坏单写者保护）。
const STALE_NO_META_GRACE_MS = 300_000;

export class Workspace {
  private held = new Map<string, Flow>();
  private links = new Map<string, string[]>();   // flowId → 软链进 worktree 的工具链相对路径（提交时反暂存，绝不入库）
  private git: SimpleGit;
  private lockRoot: string;
  constructor(
    private repoRoot: string,
    private wtRoot = join(repoRoot, ".kunpeng", "wt"),
    private _now: () => number = Date.now,
  ) {
    this.git = simpleGit(repoRoot);
    this.lockRoot = join(wtRoot, "..", "locks"); // .kunpeng/locks
  }
  /** 主仓根(非 worktree)。闸门观察账本 / gates.json 落在 <root>/.kunpeng 下。 */
  get root(): string { return this.repoRoot; }
  private lockPath(flowId: string) { return join(this.lockRoot, `${flowId}.lock`); }
  private metaPath(flowId: string) { return join(this.lockPath(flowId), "meta.json"); }
  private flowByConvention(flowId: string): Flow {
    return this.held.get(flowId) ?? { id: flowId, branch: `kp/${flowId}`, path: join(this.wtRoot, flowId) };
  }

  async acquire(flowId: string, base?: string): Promise<Flow> {
    if (this.held.has(flowId)) throw new Error(`write lock already held: ${flowId}`);
    // 跨进程单写者锁：mkdir 是原子操作，已存在即抛 EEXIST → 另一进程正持锁（C1）。
    await mkdir(this.lockRoot, { recursive: true });
    try { await mkdir(this.lockPath(flowId)); }
    catch { throw new Error(`write lock already held (cross-process): ${flowId}`); }
    try {
      await writeFile(this.metaPath(flowId), `${JSON.stringify({
        schema: LOCK_SCHEMA,
        pid: process.pid,
        host: os.hostname(),
        flowId,
        startedAt: new Date(this._now()).toISOString(),
      } satisfies LockMeta, null, 2)}\n`);
    } catch (e) {
      await rm(this.lockPath(flowId), { recursive: true, force: true }).catch(() => {});
      throw e;
    }
    const branch = `kp/${flowId}`;
    const path = join(this.wtRoot, flowId);
    try {
      // 给了 base → 从该 ref 分叉（段间顺序：后段 off 集成分支）；
      // 没给 base → 默认 fork off 本地 main（若存在），而非当前 HEAD——
      // 否则主仓停在陈旧分支时，autopilot/maintain 的流会基于陈旧基线、合 main 时撞冲突。MEMORY: branch-from-local-main。
      const effectiveBase = base ?? (await this.defaultBase());
      await this.git.raw(effectiveBase
        ? ["worktree", "add", "-b", branch, path, effectiveBase]
        : ["worktree", "add", "-b", branch, path]);
    } catch (e) {
      await rm(this.lockPath(flowId), { recursive: true, force: true }).catch(() => {}); // 失败要释放锁
      throw e;
    }
    // 让隔离 worktree 能跑项目工具链：把主仓的 node_modules 软链进来。
    // worktree 不含 gitignore 的 node_modules，否则 vitest/tsc 等验收/检查在 worktree 里解析不到 → 假失败。
    this.links.set(flowId, await this.linkToolchain(path).catch(() => []));
    const flow: Flow = { id: flowId, branch, path };
    this.held.set(flowId, flow);
    return flow;
  }

  /** S2 切片4:续跑时从最近 checkpoint tag 重建 worktree(恢复 implement 代码);无 checkpoint 则从 main 全新分叉。
   *  复用 acquire(锁/工具链/held 全走它):删残留 kp/<flowId> 分支→以 checkpoint tag 当 base 让 -b 重建。 */
  async acquireResume(flowId: string): Promise<Flow> {
    const cps = await listCheckpoints(this.repoRoot, flowId);
    if (cps.length === 0) return this.acquire(flowId, "main");
    const order = ["verify", "implement", "spec"];
    const pick = order.map((s) => cps.find((c) => c.stage === s)).find(Boolean) ?? cps[0];
    await this.git.raw(["branch", "-D", `kp/${flowId}`]).catch(() => {});
    return this.acquire(flowId, `kp-ckpt/${flowId}/${pick.stage}`);
  }

  /** 没显式 base 时的默认基线：本地 main（若存在），否则 undefined（回退当前 HEAD，不破坏无 main 的仓）。
   *  防主仓停在陈旧分支时 flow 基于陈旧基线。MEMORY: branch-from-local-main。 */
  private async defaultBase(): Promise<string | undefined> {
    const branches = await this.git.branchLocal().catch(() => ({ all: [] as string[] }));
    return branches.all.includes("main") ? "main" : undefined;
  }

  /** 只软链 node_modules；dist 由工作区自建（repoRoot 本身 + 一级子目录，覆盖 monorepo/子包如 orchestrator/）。
   *  返回创建的相对路径（提交时反暂存，绝不入库）。
   *  best-effort：无工具链产物或非 node 项目则静默跳过。 */
  private async linkToolchain(wtPath: string): Promise<string[]> {
    const created: string[] = [];
    const dirs = [this.repoRoot];
    try {
      for (const e of await readdir(this.repoRoot, { withFileTypes: true })) {
        if (e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith(".")) dirs.push(join(this.repoRoot, e.name));
      }
    } catch { /* repoRoot 读不了：跳过 */ }
    for (const dir of dirs) {
      for (const name of ["node_modules"]) {
        const src = join(dir, name);
        try { await stat(src); } catch { continue; }                 // 主仓此处无对应工具链产物
        const rel = dir === this.repoRoot ? name : join(basename(dir), name);
        const dest = join(wtPath, rel);
        try { await stat(dest); continue; } catch { /* 不存在才链 */ }
        try { await symlink(src, dest, "dir"); created.push(rel); } catch { /* 链失败：跳过 */ }
      }
    }
    return created;
  }

  async reclaimDeadLocks(opts: ReclaimDeadLocksOptions = {}): Promise<ReclaimDeadLocksResult> {
    const now = opts.now ?? this._now;                       // H2：与 acquire 同一时钟源（可注入）
    const isAlive = opts.isAlive ?? isProcessAlive;
    const graceMs = opts.graceMs ?? STALE_NO_META_GRACE_MS;  // H1：无 meta 锁更保守，避开 acquire mkdir→写meta 的窗口误删活锁
    const reclaimed: string[] = [];
    const skipped: string[] = [];

    let entries: Dirent[];
    try {
      entries = await readdir(this.lockRoot, { withFileTypes: true });
    } catch {
      return { reclaimed, skipped };
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.endsWith(".lock")) continue;
      const flowId = entry.name.slice(0, -".lock".length);
      // B2：单锁失败（权限/IO/git 异常）只记日志并跳过，绝不中断整轮清扫，否则后续死锁会漏清且被 createContext 的 .catch 静默吞掉。
      try {
        const decision = await this.shouldReclaim(flowId, now, isAlive, graceMs);
        if (!decision.reclaim) { skipped.push(flowId); continue; }

        console.error(`[workspace] reclaim dead lock flowId=${flowId} reason=${decision.reason}${decision.pid === undefined ? "" : ` pid=${decision.pid}`}`);
        await this.git.raw(["worktree", "remove", "--force", join(this.wtRoot, flowId)]).catch(() => {});

        // B1：分支归档零数据丢失——仅当源分支真存在才改名，且归档名按已存在分支去重（绝不撞名静默失败）。
        // 归档失败但源分支仍在 → 不删锁，保持「锁+分支」一致态并报 skipped，绝不留下孤儿 kp/<id> 却谎报 reclaimed。
        if (await this.archiveBranch(flowId, now)) {
          try {
            await rm(this.lockPath(flowId), { recursive: true, force: true });
            reclaimed.push(flowId);
          } catch (e) {
            console.error(`[workspace] WARN 删锁失败 flowId=${flowId}: ${String(e)}（保留锁，下轮再试）`);
            skipped.push(flowId);
          }
        } else {
          skipped.push(flowId);
        }
      } catch (e) {
        console.error(`[workspace] WARN 重收单锁异常 flowId=${flowId}: ${String(e)}（跳过，不中断清扫）`);
        skipped.push(flowId);
      }
    }

    if (reclaimed.length) await this.git.raw(["worktree", "prune"]).catch(() => {});
    return { reclaimed, skipped };
  }

  /** 把孤儿 kp/<flowId> 归档为唯一名 kp-stale/<flowId>-<ts>[-n]（保留崩溃前已验证 commit）。
   *  源分支不存在（崩在建分支前）→ 视为成功（无需归档）。改名真失败（源仍在）→ 返回 false，调用方据此不删锁。 */
  private async archiveBranch(flowId: string, now: () => number): Promise<boolean> {
    const existing = new Set((await this.git.branchLocal().catch(() => ({ all: [] as string[] }))).all);
    // known-limitation：若 refs/heads/kp/<id> 是损坏 ref，git branch 会静默略过它（exit 0），这里会误判「无源分支」→
    // 删锁但不归档。前置条件已是坏仓，commit 对象与 ref 文件仍在、可经 reflog/fsck 找回，无真实数据丢失，故不额外兜。
    if (!existing.has(`kp/${flowId}`)) return true; // 无源分支：无可归档，按成功放行删锁
    const stem = `kp-stale/${flowId}-${now().toString(36)}`;
    let dest = stem;
    for (let n = 1; existing.has(dest); n++) dest = `${stem}-${n}`; // 去重：跨轮同时钟也不撞名
    try {
      await this.git.raw(["branch", "-m", `kp/${flowId}`, dest]);
      return true;
    } catch (e) {
      console.error(`[workspace] WARN 归档分支失败 kp/${flowId} → ${dest}: ${String(e)}（保留锁，避免遗留孤儿分支阻塞重跑）`);
      return false;
    }
  }

  private async shouldReclaim(
    flowId: string,
    now: () => number,
    isAlive: (pid: number) => boolean,
    graceMs: number,
  ): Promise<{ reclaim: true; reason: "dead-pid" | "stale-no-meta"; pid?: number } | { reclaim: false }> {
    const meta = await this.readLockMeta(flowId);
    if (meta) {
      if (meta.host !== os.hostname()) return { reclaim: false };
      if (isAlive(meta.pid)) return { reclaim: false };
      return { reclaim: true, reason: "dead-pid", pid: meta.pid };
    }

    const s = await stat(this.lockPath(flowId));
    if (now() - s.mtimeMs < graceMs) return { reclaim: false };
    return { reclaim: true, reason: "stale-no-meta" };
  }

  private async readLockMeta(flowId: string): Promise<LockMeta | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.metaPath(flowId), "utf8"));
      if (!isLockMeta(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /** 在 worktree 内提交所有改动到 kp/<flowId> 分支，让已验证的代码留存（C2）。
   *  --allow-empty 使无改动时也不抛错（如 FakeRunner 不落盘）。返回 commit SHA。 */
  async commit(flowId: string, message: string): Promise<string | null> {
    const flow = this.held.get(flowId);
    if (!flow) return null;
    const wtGit = simpleGit(flow.path);
    await wtGit.raw(["add", "-A"]);
    // 工具链软链（node_modules）绝不入库：add -A 之后反暂存它们（.gitignore 的 dir 规则不匹配 symlink）。
    const links = this.links.get(flowId) ?? [];
    if (links.length) await wtGit.raw(["reset", "--", ...links]).catch(() => {});
    await wtGit.raw(["commit", "--allow-empty", "-m", message]);
    return (await wtGit.revparse(["HEAD"])).trim();
  }

  /** S2 切片2:提交本流 worktree 当前状态并打 checkpoint tag(kp-ckpt/<flowId>/<stage>),供崩溃续跑恢复 worktree。 */
  async checkpoint(flowId: string, stage: string): Promise<CkptResult> {
    const sha = await this.commit(flowId, `kp(${flowId}): ${stage} checkpoint`);
    if (sha === null) return { ok: false, error: "flow not held" };
    return snapshotCheckpoint(this.repoRoot, flowId, stage);
  }

  async release(flowId: string): Promise<void> {
    const flow = this.flowByConvention(flowId);
    await this.git.raw(["worktree", "remove", "--force", flow.path]);
    await removeFlowTmpDir(flow.path);
    await rm(this.lockPath(flowId), { recursive: true, force: true });
    this.held.delete(flowId);
  }

  async rollback(flowId: string): Promise<void> {
    const policy = rollbackPolicy(process.env.KUNPENG_KEEP_WORKTREE);
    const flow = this.flowByConvention(flowId);
    console.error(`[rollback] ${policy.reason} ${flowId}`);
    if (policy.removeWorktree) {
      await this.git.raw(["worktree", "remove", "--force", flow.path]);
      await rm(flow.path, { recursive: true, force: true });
    }
    await removeFlowTmpDir(flow.path);
    if (policy.deleteBranch) {
      await this.git.raw(["branch", "-D", flow.branch]);
    }
    await rm(this.lockPath(flowId), { recursive: true, force: true });
    this.held.delete(flowId);
  }
}

/** 对一组 repo 各跑一次 reclaimDeadLocks，best-effort：repo 目录不存在/非 git 仓（simple-git 构造**同步抛**）
 *  或重收异常，都只记日志不抛——绝不挡调用方启动（如 serve 总控台遍历 registry 时遇到被删/移走的陈旧条目）。
 *  注意：构造抛错在 `.reclaimDeadLocks()` 之前发生，promise 链上的 `.catch` 接不住，必须整体 try/catch。 */
export async function reclaimReposBestEffort(repoPaths: string[]): Promise<void> {
  for (const rp of repoPaths) {
    try {
      await new Workspace(rp).reclaimDeadLocks();
    } catch (e) {
      console.error(`[workspace] 跳过无法清理的 repo ${rp}: ${String(e)}`);
    }
  }
}

function isLockMeta(value: unknown): value is LockMeta {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.schema === LOCK_SCHEMA
    && typeof v.pid === "number"
    && Number.isInteger(v.pid)
    && typeof v.host === "string"
    && typeof v.flowId === "string"
    && typeof v.startedAt === "string";
}
