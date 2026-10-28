import { join } from "node:path";

export interface TmuxNewSessionOptions {
  sessionName: string;
  cwd: string;
  shell?: string;
}

export interface ReviveDecisionInput {
  poolHasAlive: boolean;
  registryEntry?: { workspaceId: string; cwd: string };
  tmuxHasSession: boolean;
  workspaceId: string;
}

export type ReviveDecision = "reuse" | "revive" | "create";

const TMUX_CANDIDATES = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"] as const;

// 换名前缀，避免旧分支按 kp-pty-* 清扫时误杀新终端会话。
export const TMUX_SESSION_PREFIX = "kpt-";

export function tmuxSessionName(id: string): string {
  return `${TMUX_SESSION_PREFIX}${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export function tmuxNewSessionArgs(o: TmuxNewSessionOptions): string[] {
  const args = ["-u", "new-session", "-A", "-D", "-s", o.sessionName, "-c", o.cwd];
  if (o.shell !== undefined) {
    args.push(o.shell);
  }
  // 会话级关掉状态栏(不带 -g,不碰用户自己的 tmux):status-left/right 会漏进 xterm 当乱码。
  // ";" 作为独立 argv 元素 = tmux 命令分隔符;-A 复用旧会话时同样执行,存量会话重连即生效。
  args.push(";", "set-option", "status", "off");
  return args;
}

export function tmuxHasSessionArgs(sessionName: string): string[] {
  return ["has-session", "-t", `=${sessionName}`];
}

export function tmuxKillSessionArgs(sessionName: string): string[] {
  return ["kill-session", "-t", `=${sessionName}`];
}

export function findTmuxBin(exists: (p: string) => boolean, pathEnv?: string): string | null {
  const fromPath = (pathEnv ?? "")
    .split(":")
    .filter(Boolean)
    .map((dir) => join(dir, "tmux"));
  const candidates = [...fromPath, ...TMUX_CANDIDATES];
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

export function resolveReviveDecision(o: ReviveDecisionInput): ReviveDecision {
  if (o.poolHasAlive) {
    return "reuse";
  }

  if (o.registryEntry?.workspaceId === o.workspaceId && o.tmuxHasSession) {
    return "revive";
  }

  return "create";
}
