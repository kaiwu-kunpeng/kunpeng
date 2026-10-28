#!/usr/bin/env node
// 串行化构建：用原子目录锁让并发 `npm run build` 排队，而非两个 tsc 同时写 dist/ 互相覆盖产出半成品/旧 dist。
// 背景：并行多 agent 改鲲鹏时（多个 chat 共享同一 repo），同时跑 `npm run build` 会撞 dist/ —— 踩过：
// serve 跑的是旧码、端点 404，重 build 才好。本锁是「保障」而非「建议」：两个 build 自动排队，谁先谁后都对。
//
// 用法：node scripts/with-build-lock.mjs <command> [args...]
//   例：node scripts/with-build-lock.mjs npx --no-install tsc -p tsconfig.json
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");   // orchestrator/
const LOCK = join(ROOT, ".build.lock");                            // 原子目录锁（两 agent 同路径 = 跨进程串行）
const STALE_MS = 5 * 60 * 1000;                                    // 持锁超 5 分钟视为死锁
const TIMEOUT_MS = 4 * 60 * 1000;                                  // 最多等 4 分钟
const POLL_MS = 300;

const cmd = process.argv.slice(2);
if (cmd.length === 0) { console.error("[build-lock] 用法: with-build-lock.mjs <command> [args...]"); process.exit(2); }

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

/** 原子取锁：mkdir 成功=拿到；EEXIST 时检查是否死锁（持有者进程已死 / 超 STALE_MS）→ 偷锁重试。 */
function tryAcquire() {
  try {
    mkdirSync(LOCK);                                               // 原子：已存在即抛 EEXIST
    writeFileSync(join(LOCK, "owner.json"), JSON.stringify({ pid: process.pid, at: Date.now() }));
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let stale = false;
    try {
      const o = JSON.parse(readFileSync(join(LOCK, "owner.json"), "utf8"));
      stale = (Date.now() - o.at > STALE_MS) || (typeof o.pid === "number" && !pidAlive(o.pid));
    } catch {
      stale = true;                                               // owner 文件缺失/坏 → 当死锁
    }
    if (stale) { rmSync(LOCK, { recursive: true, force: true }); return tryAcquire(); }
    return false;
  }
}

const t0 = Date.now();
let waited = false;
while (!tryAcquire()) {
  if (!waited) { console.error("[build-lock] 另一个构建持锁中，排队等待…"); waited = true; }
  if (Date.now() - t0 > TIMEOUT_MS) {
    console.error(`[build-lock] 等锁超时(${TIMEOUT_MS}ms)，疑似卡死。确认无构建在跑后手动删 ${LOCK} 再重试。`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
if (waited) console.error("[build-lock] 已拿到锁，开始构建。");

let code = 1;
try {
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit", shell: false, cwd: ROOT });
  code = r.status ?? 1;
} finally {
  rmSync(LOCK, { recursive: true, force: true });                 // 务必释放，即使构建失败
}
process.exit(code);
