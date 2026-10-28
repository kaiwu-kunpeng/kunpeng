import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isIdleShellCommand, planPtyOrphanSweep, sweepPtyOrphans } from "../../src/server/pty-orphan.js";
import { PtySessionPool, type PtyHandle, type PtyRemoveReason } from "../../src/server/pty-pool.js";
import { ptyRegistryHooks } from "../../src/server/pty-registry-hooks.js";
import { readPtyRegistry } from "../../src/server/pty-registry.js";
import { tmuxPtyFactory } from "../../src/server/pty-tmux-factory.js";
import { TMUX_SESSION_PREFIX, tmuxSessionName } from "../../src/server/pty-tmux.js";

// 背景（2026-10-03 一晚三次「Claude 退出」）：驾驶舱终端是 tmux 会话，里面跑着 Claude Code。三条杀伤路径：
//   ① 历史代码的孤儿清扫按 kp-pty-* 前缀杀「自己登记表里没有」的会话——任何旧分支/worktree 跑一次测试就全杀；
//   ② 会话池 30 分钟没浏览器订阅就 reap → handle.kill() → tmux kill-session，走开半小时终端连程序一起死；
//   ③ reap 顺手删登记表，之后既复活不了，又会被清扫当未登记孤儿杀掉。
// 本测试锁定：新前缀 kpt-（旧代码看得见碰不着）、有程序在跑绝不杀、闲置只断客户端不杀会话、登记只在真死时删。

const DAY = 24 * 3600 * 1000;
const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "kp-pty-keepalive-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// 假 tmux：记录参数；ls 回四条 kpt- 会话 + 一条旧前缀 + 一条无关；list-panes 给出各会话窗格前台命令。绝不碰真 tmux。
function fakeTmux(dir: string, o: { panesFail?: boolean } = {}): { bin: string; log: string } {
  const log = join(dir, "tmux-calls.log");
  const bin = join(dir, "tmux");
  writeFileSync(bin, [
    "#!/bin/sh",
    `echo "$*" >> "${log}"`,
    'if [ "$1" = "ls" ]; then',
    '  printf "kpt-pty-idle-1 1700000000 0\\nkpt-pty-busy-1 1700000000 0\\nkpt-pty-live-1 1700000000 1\\nkp-pty-legacy-1 1700000000 0\\nmain 1700000000 0\\n"',
    "  exit 0",
    "fi",
    'if [ "$1" = "list-panes" ]; then',
    o.panesFail ? "  exit 1" : '  printf "kpt-pty-idle-1 zsh\\nkpt-pty-busy-1 claude\\nkpt-pty-live-1 -zsh\\nkp-pty-legacy-1 zsh\\nmain /bin/zsh\\n"',
    "  exit 0",
    "fi",
    "exit 0",
  ].join("\n") + "\n");
  chmodSync(bin, 0o755);
  writeFileSync(log, "");
  return { bin, log };
}

function calls(log: string): string[] {
  return readFileSync(log, "utf8").split("\n").filter(Boolean);
}

class FakeHandle implements PtyHandle {
  killed = false;
  detached = false;
  private exitCb: ((code: number) => void) | undefined;
  constructor(private readonly withDetach: boolean) {
    if (withDetach) this.detach = () => { this.detached = true; };
  }
  write(): void {}
  resize(): void {}
  onData(): void {}
  onExit(cb: (code: number) => void): void { this.exitCb = cb; }
  kill(): void { this.killed = true; }
  detach?: () => void;
  exit(code: number): void { this.exitCb?.(code); }
}

describe("终端会话不许误杀（作者锁定）", () => {
  it("① 会话名前缀换成 kpt-，旧前缀 kp-pty-* 的会话清扫一律不碰（旧代码对新会话同样无感）", () => {
    expect(TMUX_SESSION_PREFIX).toBe("kpt-");
    expect(tmuxSessionName("pty-1791081905577-1")).toBe("kpt-pty-1791081905577-1");
    expect(tmuxSessionName("a.b:c d")).toBe("kpt-a_b_c_d");
    const plan = planPtyOrphanSweep({
      tmuxSessions: [
        { name: "kp-pty-legacy-1", activityAt: 0, attached: 0 },
        { name: "kpt-pty-orphan-1", activityAt: 0, attached: 0 },
      ],
      registry: {},
      now: 100 * DAY,
    });
    expect(plan.killTmux).toEqual(["kpt-pty-orphan-1"]);
  });

  it("② 决策：窗格里有程序在跑（busy）的会话绝不杀——没登记也不杀，登记了超 TTL 也不杀不删", () => {
    const now = 100 * DAY;
    const plan = planPtyOrphanSweep({
      tmuxSessions: [
        { name: "kpt-pty-busy-unreg", activityAt: now, attached: 0, busy: true },
        { name: "kpt-pty-busy-old", activityAt: now - 30 * DAY, attached: 0, busy: true },
        { name: "kpt-pty-idle-unreg", activityAt: now, attached: 0, busy: false },
        { name: "kpt-pty-idle-old", activityAt: now - 30 * DAY, attached: 0, busy: false },
      ],
      registry: { "pty-busy-old": { createdAt: 0 }, "pty-idle-old": { createdAt: 0 } },
      now,
    });
    expect(plan.killTmux.sort()).toEqual(["kpt-pty-idle-old", "kpt-pty-idle-unreg"]);
    expect(plan.dropRegistry).toEqual(["pty-idle-old"]);
    expect(isIdleShellCommand("zsh")).toBe(true);
    expect(isIdleShellCommand("-zsh")).toBe(true);
    expect(isIdleShellCommand("/bin/bash")).toBe(true);
    expect(isIdleShellCommand("claude")).toBe(false);
    expect(isIdleShellCommand("node")).toBe(false);
  });

  it("② 真执行：扫 tmux 时查 list-panes 的 pane_current_command，只杀空闲 shell 的未登记会话", async () => {
    const dir = tmp();
    const { bin, log } = fakeTmux(dir);
    const plan = await sweepPtyOrphans({ tmuxBin: bin, registryPath: join(dir, "pty-registry.json") });
    expect(plan.killTmux).toEqual(["kpt-pty-idle-1"]);
    const seen = calls(log);
    expect(seen.some((l) => l.startsWith("list-panes") && l.includes("pane_current_command"))).toBe(true);
    expect(seen.filter((l) => l.startsWith("kill-session"))).toEqual(["kill-session -t =kpt-pty-idle-1"]);
  });

  it("② 真执行：list-panes 查不到就当全部有活在跑（fail-closed），一个都不杀", async () => {
    const dir = tmp();
    const { bin, log } = fakeTmux(dir, { panesFail: true });
    const plan = await sweepPtyOrphans({ tmuxBin: bin, registryPath: join(dir, "pty-registry.json") });
    expect(plan.killTmux).toEqual([]);
    expect(calls(log).some((l) => l.startsWith("kill-session"))).toBe(false);
  });

  it("③ 池子闲置回收：句柄支持 detach 就只断客户端，不 kill；onRemoved 带 reason=detached", () => {
    const clock = { t: 1000 };
    const removed: Array<[string, PtyRemoveReason]> = [];
    const handles: FakeHandle[] = [];
    const pool = new PtySessionPool({
      factory: () => { const h = new FakeHandle(true); handles.push(h); return h; },
      now: () => clock.t,
      idleReapMs: 1000,
      onRemoved: (id, reason) => removed.push([id, reason]),
    });
    const s = pool.create({ workspaceId: "ws", cwd: "/tmp" });
    clock.t += 1500;
    expect(pool.reap()).toEqual([s.id]);
    expect(handles[0].detached).toBe(true);
    expect(handles[0].killed).toBe(false);
    expect(removed).toEqual([[s.id, "detached"]]);
  });

  it("③ 池子：无 detach 的句柄闲置照旧 kill（reason=killed）；进程自己退出过了宽限期 reason=exited", () => {
    const clock = { t: 1000 };
    const removed: Array<[string, PtyRemoveReason]> = [];
    const handles: FakeHandle[] = [];
    const pool = new PtySessionPool({
      factory: () => { const h = new FakeHandle(false); handles.push(h); return h; },
      now: () => clock.t,
      idleReapMs: 1000,
      deadGraceMs: 100,
      onRemoved: (id, reason) => removed.push([id, reason]),
    });
    const a = pool.create({ workspaceId: "ws", cwd: "/tmp" });
    const b = pool.create({ workspaceId: "ws", cwd: "/tmp" });
    handles[1].exit(0);
    clock.t += 1500;
    expect(pool.reap().sort()).toEqual([a.id, b.id].sort());
    expect(handles[0].killed).toBe(true);
    expect(removed.sort()).toEqual([[a.id, "killed"], [b.id, "exited"]].sort());
  });

  it("③ tmux 工厂：detach 只杀客户端进程、绝不发 kill-session；kill 才发 kill-session", () => {
    const execs: string[][] = [];
    const inner = new FakeHandle(false);
    const factory = tmuxPtyFactory("/usr/bin/tmux", {
      ptySpawn: () => inner,
      execTmux: (args) => { execs.push([...args]); },
    });
    const h = factory({ id: "pty-7", shell: "/bin/zsh", cwd: "/tmp", cols: 80, rows: 24 });
    expect(typeof h.detach).toBe("function");
    h.detach?.();
    expect(inner.killed).toBe(true);
    expect(execs).toEqual([]);
    h.kill();
    expect(execs).toEqual([["kill-session", "-t", "=kpt-pty-7"]]);
  });

  it("④ 登记表接线：detached 保留登记，exited / killed 才删", async () => {
    const dir = tmp();
    const path = join(dir, "pty-registry.json");
    const hooks = ptyRegistryHooks(path);
    const base = { workspaceId: "ws", cwd: "/tmp", shell: "/bin/zsh", cols: 80, rows: 24, alive: true, createdAt: 1, updatedAt: 1 };
    // 登记表是读-改-写落盘，逐个登记、等落盘再登下一个（并发登记的合并不在本测试范围）。
    for (const id of ["pty-a", "pty-b"]) {
      hooks.onCreated({ ...base, id });
      for (let i = 0; i < 80 && !(id in await readPtyRegistry(path)); i++) await new Promise((r) => setTimeout(r, 25));
    }
    expect(Object.keys(await readPtyRegistry(path)).sort()).toEqual(["pty-a", "pty-b"]);
    hooks.onRemoved("pty-a", "detached");
    await new Promise((r) => setTimeout(r, 150));
    expect(Object.keys(await readPtyRegistry(path)).sort()).toEqual(["pty-a", "pty-b"]);
    for (const [id, reason] of [["pty-a", "exited"], ["pty-b", "killed"]] as const) {
      hooks.onRemoved(id, reason);
      for (let i = 0; i < 80 && id in await readPtyRegistry(path); i++) await new Promise((r) => setTimeout(r, 25));
    }
    expect(await readPtyRegistry(path)).toEqual({});
  });

  it("④ startDashboard 的会话池必须经 ptyRegistryHooks 接登记表（不再手搓无条件删登记的 onRemoved）", () => {
    const src = readFileSync(new URL("../../src/server/http.ts", import.meta.url), "utf8");
    expect(src).toMatch(/new PtySessionPool\(\{[^}]*ptyRegistryHooks\(/);
    expect(src).not.toContain("removePtyEntry(");
  });
});