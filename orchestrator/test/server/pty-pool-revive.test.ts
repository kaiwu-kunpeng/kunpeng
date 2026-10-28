import { describe, it, expect } from "vitest";
import { PtySessionPool, type PtyHandle, type PtySpawnOpts } from "../../src/server/pty-pool.js";
import { tmuxPtyFactory } from "../../src/server/pty-tmux-factory.js";

function fakeHandle(): PtyHandle {
  return { write() {}, resize() {}, onData() {}, onExit() {}, kill() {} };
}

describe("PtySessionPool 指定 id 创建(复活)", () => {
  it("create 透传显式 id,工厂能看到该 id", () => {
    const seen: string[] = [];
    const pool = new PtySessionPool({ factory: (o: PtySpawnOpts) => { seen.push(o.id); return fakeHandle(); } });
    const info = pool.create({ workspaceId: "ws1", cwd: "/tmp", id: "pty-fixed-1" });
    expect(info.id).toBe("pty-fixed-1");
    expect(seen).toEqual(["pty-fixed-1"]);
  });
  it("不给 id 仍自动铸造且透传给工厂", () => {
    const seen: string[] = [];
    const pool = new PtySessionPool({ factory: (o: PtySpawnOpts) => { seen.push(o.id); return fakeHandle(); } });
    const info = pool.create({ workspaceId: "ws1", cwd: "/tmp" });
    expect(info.id.length).toBeGreaterThan(0);
    expect(seen).toEqual([info.id]);
  });
  it("重复 id 抛错", () => {
    const pool = new PtySessionPool({ factory: () => fakeHandle() });
    pool.create({ workspaceId: "ws1", cwd: "/tmp", id: "dup" });
    expect(() => pool.create({ workspaceId: "ws1", cwd: "/tmp", id: "dup" })).toThrow();
  });
  it("onCreated/onRemoved 生命周期钩子", () => {
    let t = 1000;
    const events: string[] = [];
    const pool = new PtySessionPool({
      factory: () => fakeHandle(),
      now: () => t,
      deadGraceMs: 5,
      onCreated: (info) => events.push(`+${info.id}`),
      onRemoved: (id) => events.push(`-${id}`),
    });
    pool.create({ workspaceId: "ws1", cwd: "/tmp", id: "s1" });
    pool.kill("s1");
    t += 10;
    pool.reap();
    expect(events).toEqual(["+s1", "-s1"]);
  });
});

describe("tmuxPtyFactory", () => {
  it("用 tmux -u new-session -A 拉起,会话名含 kpt- 前缀", () => {
    const calls: Array<{ bin: string; args: string[] }> = [];
    const factory = tmuxPtyFactory("/opt/homebrew/bin/tmux", {
      ptySpawn: (bin, args) => { calls.push({ bin, args: [...args] }); return fakeHandle(); },
    });
    factory({ id: "pty-1", shell: "/bin/zsh", cwd: "/tmp", cols: 80, rows: 24 });
    expect(calls[0].bin).toBe("/opt/homebrew/bin/tmux");
    expect(calls[0].args.slice(0, 3)).toEqual(["-u", "new-session", "-A"]);
    expect(calls[0].args).toContain("kpt-pty-1");
  });
  it("kill 同时请求 kill-session(best-effort)", () => {
    const execs: string[][] = [];
    const factory = tmuxPtyFactory("/usr/bin/tmux", {
      ptySpawn: () => fakeHandle(),
      execTmux: (args) => { execs.push([...args]); },
    });
    const h = factory({ id: "pty-2", shell: "/bin/zsh", cwd: "/tmp", cols: 80, rows: 24 });
    h.kill();
    expect(execs.some((a) => a[0] === "kill-session" && a.includes("=kpt-pty-2"))).toBe(true);
  });
  it("传入的 env 被强制补 TERM 且剔除 TMUX", () => {
    let seenEnv: Record<string, string> = {};
    const factory = tmuxPtyFactory("/usr/bin/tmux", {
      ptySpawn: (_bin, _args, o) => { seenEnv = o.env; return fakeHandle(); },
    });
    factory({ id: "pty-3", shell: "/bin/zsh", cwd: "/tmp", cols: 80, rows: 24, env: { TMUX: "/tmp/x", FOO: "bar" } });
    expect(seenEnv.TERM).toBe("xterm-256color");
    expect(seenEnv.FOO).toBe("bar");
    expect("TMUX" in seenEnv).toBe(false);
  });
});
