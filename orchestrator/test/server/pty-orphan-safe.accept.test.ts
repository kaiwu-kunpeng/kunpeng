import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startDashboard } from "../../src/server/http.js";
import { planPtyOrphanSweep, sweepPtyOrphans } from "../../src/server/pty-orphan.js";

// 背景：startDashboard 起服务就清扫 kpt-pty-* tmux 会话，登记表按 os.homedir() 定位。
// 测试 / 第二实例把 HOME 指到临时目录后登记表为空，于是把宿主机上正连着浏览器的驾驶舱终端
// 当孤儿杀掉（里面跑着的 Claude Code 随之退出）。本测试锁定两道防线：
//   ① 有客户端连着的会话绝不是孤儿，无论登记与否、闲置多久都不杀；
//   ② 清扫只在 kunpeng serve 入口显式开启，startDashboard 缺省不碰 tmux。

const DAY = 24 * 3600 * 1000;
const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "kpt-pty-safe-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// 假 tmux：只会把收到的参数记进日志；ls 固定回「一条有人连、一条没人连、一条非 kp 前缀」。绝不碰真 tmux。
function fakeTmux(dir: string): { bin: string; log: string } {
  const log = join(dir, "tmux-calls.log");
  const bin = join(dir, "tmux");
  writeFileSync(bin, [
    "#!/bin/sh",
    `echo "$*" >> "${log}"`,
    'if [ "$1" = "ls" ]; then',
    '  printf "kpt-pty-live-1 1700000000 1\\nkpt-pty-dead-1 1700000000 0\\nmain 1700000000 1\\n"',
    "  exit 0",
    "fi",
    'if [ "$1" = "has-session" ]; then exit 1; fi',
    "exit 0",
  ].join("\n") + "\n");
  chmodSync(bin, 0o755);
  writeFileSync(log, "");
  return { bin, log };
}

function calls(log: string): string[] {
  return readFileSync(log, "utf8").split("\n").filter(Boolean);
}

async function waitFor(pred: () => boolean, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** 把假 tmux 放到 PATH 最前、HOME 指到临时目录，再起 dashboard；结束后恢复环境。 */
async function startWithFakeTmux(dir: string, extra: { sweepPtyOrphans?: boolean }) {
  const prevPath = process.env.PATH;
  const prevHome = process.env.HOME;
  process.env.PATH = `${dir}:${prevPath ?? ""}`;
  process.env.HOME = dir;
  try {
    return await startDashboard({ port: 0, stateDir: join(dir, "state"), execPath: "/usr/bin/false", cliJs: "/nonexistent/cli.js", ...extra });
  } finally {
    process.env.PATH = prevPath;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  }
}

describe("pty 孤儿清扫不得误杀活终端（作者锁定）", () => {
  it("决策：有客户端连着的 kpt-pty 会话，无论有没有登记、闲置多久，都不杀也不删登记", () => {
    const now = 100 * DAY;
    const plan = planPtyOrphanSweep({
      tmuxSessions: [
        { name: "kpt-pty-live-1", activityAt: now - 30 * DAY, attached: 1 },
        { name: "kpt-pty-live-2", activityAt: now - 30 * DAY, attached: 2 },
        { name: "kpt-pty-dead-1", activityAt: now, attached: 0 },
      ],
      registry: { "pty-live-2": { createdAt: 0 } },
      now,
    });
    expect(plan.killTmux).toEqual(["kpt-pty-dead-1"]);
    expect(plan.dropRegistry).toEqual([]);
  });

  it("真执行：扫 tmux 时要带 session_attached，只杀没人连的未登记会话", async () => {
    const dir = tmp();
    const { bin, log } = fakeTmux(dir);
    const plan = await sweepPtyOrphans({ tmuxBin: bin, registryPath: join(dir, "pty-registry.json") });
    expect(plan.killTmux).toEqual(["kpt-pty-dead-1"]);
    const seen = calls(log);
    expect(seen.some((l) => l.startsWith("ls ") && l.includes("session_attached"))).toBe(true);
    expect(seen.filter((l) => l.startsWith("kill-session"))).toEqual(["kill-session -t =kpt-pty-dead-1"]);
  });

  it("startDashboard 缺省不扫 tmux：测试 / 第二实例起服务绝不碰宿主机终端", async () => {
    const dir = tmp();
    const { log } = fakeTmux(dir);
    const server = await startWithFakeTmux(dir, {});
    try {
      await new Promise((r) => setTimeout(r, 400));
      expect(calls(log)).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("startDashboard 显式 sweepPtyOrphans: true 才扫，且只杀没人连的", async () => {
    const dir = tmp();
    const { log } = fakeTmux(dir);
    const server = await startWithFakeTmux(dir, { sweepPtyOrphans: true });
    try {
      await waitFor(() => calls(log).some((l) => l.startsWith("kill-session")), 5000);
      const seen = calls(log);
      expect(seen.some((l) => l.startsWith("ls "))).toBe(true);
      expect(seen.filter((l) => l.startsWith("kill-session"))).toEqual(["kill-session -t =kpt-pty-dead-1"]);
    } finally {
      await server.close();
    }
  });

  it("kunpeng serve 入口的每一处 startDashboard 都显式开扫", () => {
    const src = readFileSync(new URL("../../src/cli-commands/board-serve.ts", import.meta.url), "utf8");
    const sites = src.match(/startDashboard\(\{[^}]*\}\)/g) ?? [];
    expect(sites.length).toBe(2);
    for (const site of sites) expect(site).toContain("sweepPtyOrphans: true");
  });
});