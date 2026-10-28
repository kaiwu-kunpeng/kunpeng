import { spawn as ptySpawn } from "node-pty";
import { chmodSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import type { PtyHandle, PtySpawnOpts } from "./pty-pool.js";

// node-pty 解包后 darwin 的 spawn-helper 常缺执行位 → 运行时 `posix_spawnp failed`。
// 首次 spawn 前兜底 chmod +x（幂等、best-effort），把这台 Mac 上实测到的坑焊死。
let helperEnsured = false;
function ensureSpawnHelperExecutable(): void {
  if (helperEnsured) return;
  helperEnsured = true;
  try {
    const require = createRequire(import.meta.url);
    const base = dirname(require.resolve("node-pty/package.json"));
    for (const rel of ["darwin-arm64", "darwin-x64"]) {
      const helper = `${base}/prebuilds/${rel}/spawn-helper`;
      if (existsSync(helper)) chmodSync(helper, 0o755);
    }
  } catch {
    /* best-effort：拿不到路径就交给 node-pty 自身报错 */
  }
}

/** 把 process.env 收拢成纯 string map（node-pty 要求 Record<string,string>，剔除 undefined）。 */
export function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") out[k] = v;
  return out;
}

export interface PtySpawnHandleOpts {
  name?: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

export function spawnPtyHandle(bin: string, args: string[], opts: PtySpawnHandleOpts): PtyHandle {
  ensureSpawnHelperExecutable();
  const term = ptySpawn(bin, args, {
    name: opts.name ?? "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: opts.env,
  });
  return {
    write: (data) => term.write(data),
    resize: (cols, rows) => {
      // 子进程已退出时 resize 会抛；吞掉避免连带打挂调用方。
      try { term.resize(cols, rows); } catch { /* 已退出 */ }
    },
    onData: (cb) => { term.onData(cb); },
    onExit: (cb) => { term.onExit(({ exitCode }) => cb(exitCode)); },
    kill: () => { try { term.kill(); } catch { /* 已退出 */ } },
  };
}

/** 真实 node-pty 工厂：注入给 PtySessionPool。spawn 一个登录 shell，包成 PtyHandle。 */
export function nodePtyFactory(opts: PtySpawnOpts): PtyHandle {
  const env = opts.env && Object.keys(opts.env).length > 0
    ? opts.env
    : { ...cleanEnv(process.env), TERM: "xterm-256color" };
  return spawnPtyHandle(opts.shell, [], {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env,
  });
}
