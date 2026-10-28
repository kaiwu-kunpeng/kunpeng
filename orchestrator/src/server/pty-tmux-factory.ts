import { execFile } from "node:child_process";
import type { PtyHandle, PtySpawnOpts } from "./pty-pool.js";
import { cleanEnv, spawnPtyHandle } from "./pty-node-factory.js";
import { tmuxKillSessionArgs, tmuxNewSessionArgs, tmuxSessionName } from "./pty-tmux.js";

export interface TmuxPtyFactoryDeps {
  ptySpawn?: (
    bin: string,
    args: string[],
    o: { cols: number; rows: number; cwd: string; env: Record<string, string> },
  ) => PtyHandle;
  execTmux?: (args: string[]) => void;
}

export function tmuxPtyFactory(tmuxBin: string, deps: TmuxPtyFactoryDeps = {}): (opts: PtySpawnOpts) => PtyHandle {
  const ptySpawn = deps.ptySpawn ?? ((bin, args, o) => spawnPtyHandle(bin, args, o));
  const execTmux = deps.execTmux ?? ((args) => {
    execFile(tmuxBin, args, { timeout: 5_000 }, (err) => {
      if (err) console.warn(`tmux 执行失败: ${err.message}`);
    });
  });

  return (opts) => {
    const sessionName = tmuxSessionName(opts.id);
    const handle = ptySpawn(
      tmuxBin,
      tmuxNewSessionArgs({ sessionName, cwd: opts.cwd, shell: opts.shell }),
      {
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.cwd,
        env: tmuxEnv(opts.env),
      },
    );

    const wrapped: PtyHandle = {
      write: (data) => handle.write(data),
      resize: (cols, rows) => handle.resize(cols, rows),
      onData: (cb) => handle.onData(cb),
      onExit: (cb) => handle.onExit(cb),
      // 只断开 tmux 客户端，服务端会话与其中运行的程序继续存活。
      detach: () => handle.kill(),
      kill: () => {
        try {
          handle.kill();
        } catch {
          // Client process cleanup is best-effort; still ask tmux to drop the server session.
        }
        try {
          execTmux(tmuxKillSessionArgs(sessionName));
        } catch {
          // Killing the tmux session is best-effort.
        }
      },
    };
    if (handle.pause) wrapped.pause = () => handle.pause?.();
    if (handle.resume) wrapped.resume = () => handle.resume?.();
    return wrapped;
  };
}

function tmuxEnv(env: Record<string, string> | undefined): Record<string, string> {
  const out = env && Object.keys(env).length > 0
    ? { ...env }
    : cleanEnv(process.env);
  out.TERM = "xterm-256color";
  delete out.TMUX;
  return out;
}
