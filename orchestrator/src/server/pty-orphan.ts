import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

import { readPtyRegistry, removePtyEntry } from "./pty-registry.js";
import { TMUX_SESSION_PREFIX, tmuxKillSessionArgs, tmuxSessionName } from "./pty-tmux.js";

const execFileAsync = promisify(execFile);
const DEFAULT_TTL_MS = 7 * 24 * 3600 * 1000;
const PTY_TMUX_PREFIX = `${TMUX_SESSION_PREFIX}pty-`;
const IDLE_SHELL_COMMANDS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "tcsh", "csh", "login"]);

export function isIdleShellCommand(command: string): boolean {
  return IDLE_SHELL_COMMANDS.has(basename(command).replace(/^-/, ""));
}

export interface PtyOrphanSweepInput {
  /** attached = 当前连着的客户端数（tmux #{session_attached}）；有人连着就不是孤儿。 */
  tmuxSessions: { name: string; activityAt: number; attached?: number; busy?: boolean }[];
  registry: Record<string, { createdAt: number }>;
  now: number;
  ttlMs?: number;
}

export interface PtyOrphanSweepPlan {
  killTmux: string[];
  dropRegistry: string[];
}

export function planPtyOrphanSweep(input: PtyOrphanSweepInput): PtyOrphanSweepPlan {
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const killTmux = new Set<string>();
  const dropRegistry = new Set<string>();
  const tmuxNames = new Set(input.tmuxSessions.map(({ name }) => name));

  for (const session of input.tmuxSessions) {
    if (!session.name.startsWith(PTY_TMUX_PREFIX)) {
      continue;
    }
    // 有客户端连着的会话绝不是孤儿：无论登记与否、闲置多久都不碰（曾把正连着浏览器的驾驶舱终端杀掉）。
    if ((session.attached ?? 0) > 0) {
      continue;
    }
    // 无客户端但窗格仍在跑程序，同样不能杀掉会话或删除登记。
    if (session.busy === true) {
      continue;
    }

    const id = session.name.slice(TMUX_SESSION_PREFIX.length);
    const hasRegistryEntry = Object.hasOwn(input.registry, id);
    if (!hasRegistryEntry) {
      killTmux.add(session.name);
      continue;
    }

    if (input.now - session.activityAt > ttlMs) {
      killTmux.add(session.name);
      dropRegistry.add(id);
    }
  }

  for (const id of Object.keys(input.registry)) {
    if (!tmuxNames.has(tmuxSessionName(id))) {
      dropRegistry.add(id);
    }
  }

  return {
    killTmux: [...killTmux],
    dropRegistry: [...dropRegistry],
  };
}

function parseTmuxSessions(stdout: string): { name: string; activityAt: number; attached: number }[] {
  const sessions: { name: string; activityAt: number; attached: number }[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^(\S+)\s+(\d+)\s+(\d+)$/.exec(line.trim());
    if (!match) {
      continue;
    }
    sessions.push({ name: match[1], activityAt: Number(match[2]) * 1000, attached: Number(match[3]) });
  }
  return sessions;
}

function parseBusySessions(stdout: string): Set<string> {
  const busy = new Set<string>();
  for (const line of stdout.split("\n")) {
    const match = /^(\S+)\s+(.+)$/.exec(line.trim());
    if (match && !isIdleShellCommand(match[2])) {
      busy.add(match[1]);
    }
  }
  return busy;
}

export async function sweepPtyOrphans(opts: {
  tmuxBin: string;
  registryPath: string;
  ttlMs?: number;
}): Promise<PtyOrphanSweepPlan> {
  let tmuxSessions: { name: string; activityAt: number; attached: number }[] = [];
  try {
    const { stdout } = await execFileAsync(opts.tmuxBin, ["ls", "-F", "#S #{session_activity} #{session_attached}"]);
    tmuxSessions = parseTmuxSessions(stdout);
  } catch {
    // A missing tmux server is equivalent to an empty session table.
  }

  let busySessions: Set<string> | undefined;
  try {
    const { stdout } = await execFileAsync(opts.tmuxBin, ["list-panes", "-a", "-F", "#{session_name} #{pane_current_command}"], { timeout: 5_000 });
    busySessions = parseBusySessions(stdout);
  } catch {
    // 查不到窗格命令就全部按 busy 处理，绝不因探测失败误杀会话。
  }

  const registry = await readPtyRegistry(opts.registryPath);
  const plan = planPtyOrphanSweep({
    tmuxSessions: tmuxSessions.map((session) => ({ ...session, busy: busySessions?.has(session.name) ?? true })),
    registry,
    now: Date.now(),
    ...(opts.ttlMs === undefined ? {} : { ttlMs: opts.ttlMs }),
  });

  for (const sessionName of plan.killTmux) {
    try {
      await execFileAsync(opts.tmuxBin, tmuxKillSessionArgs(sessionName));
    } catch {
      // Each cleanup action is best-effort; continue with the remaining plan.
    }
  }
  for (const id of plan.dropRegistry) {
    try {
      await removePtyEntry(opts.registryPath, id);
    } catch {
      // Each cleanup action is best-effort; continue with the remaining plan.
    }
  }

  if (plan.killTmux.length > 0 || plan.dropRegistry.length > 0) {
    console.log(`[pty-orphan] 清扫: 杀 tmux ${plan.killTmux.length} 个, 删登记 ${plan.dropRegistry.length} 条`);
  }
  return plan;
}
