import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { STALLED_THRESHOLD, loadLedger } from "../../src/metrics/loop-yield.js";
import { recordAndWarn } from "../../src/metrics/loop-yield-record.js";

const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");

describe("四条循环的记账口径（锁死表达式，防止实现漂移）", () => {
  test("autopilot：驳回也算真处理——yield 必须含 rejected，否则只驳回的一轮会被误报空转", async () => {
    const s = await src("../../src/cli-commands/loop-core.ts");
    // 单仓与多仓两个分支都必须把 rejected 计入 yield。
    expect(s).toMatch(/yield:\s*res\.merged\.length\s*\+\s*res\.rejected\.length/);
    expect(s).toMatch(/yield:\s*o\.result\.merged\.length\s*\+\s*o\.result\.rejected\.length/);
    // input 必须是本轮看到的全部门（含 skipped），否则「有门但全跳过」看不出来。
    expect(s).toMatch(/input:\s*res\.merged\.length\s*\+\s*res\.rejected\.length\s*\+\s*res\.skipped\.length/);
  });

  test("autopilot：跳过整仓的那轮不记账（本轮该项目根本没轮到）", async () => {
    const s = await src("../../src/cli-commands/loop-core.ts");
    const skipBranch = s.slice(s.indexOf("跳过整仓"), s.indexOf("跳过整仓") + 200);
    expect(skipBranch).not.toContain("recordAndWarn");
  });

  test("flywheel：busy（活锁跳过）那轮不记账——被别的流占着不是空转", async () => {
    const s = await src("../../src/cli-commands/flywheel-eval.ts");
    expect(s).toMatch(/report\.skipped\s*!==\s*["']busy["']/);
    expect(s).toContain("recordAndWarn");
  });

  test("scout：input 恒为 1（每轮总有一个 topic），yield 是发现数", async () => {
    const s = await src("../../src/cli-commands/board-serve.ts");
    const block = s.slice(s.indexOf('loop: "scout"'), s.indexOf('loop: "scout"') + 220);
    expect(block).toMatch(/input:\s*1/);
    expect(block).toMatch(/yield:\s*findings\.length/);
  });

  test("四条循环各自的 loop 名都在，且都真的调了 recordAndWarn", async () => {
    const core = await src("../../src/cli-commands/loop-core.ts");
    expect(core).toContain('loop: "autopilot"');
    expect(core).toContain('loop: "patrol"');
    expect(core).toContain("recordAndWarn");
    expect(await src("../../src/cli-commands/flywheel-eval.ts")).toContain('loop: "flywheel"');
    expect(await src("../../src/cli-commands/board-serve.ts")).toContain('loop: "scout"');
  });

  test("loop-yield 命令真注册进 cli", async () => {
    const s = await src("../../src/cli.ts");
    expect(s).toContain("loop-yield-cmd.js");
    expect(s).toContain("loop-yield");
  });
});

describe("真 dispatch：命令能被 CLI 认出来并跑出告警", () => {
  test("三轮零产出后 loop-yield 打出告警且退出码非 0", async () => {
    await import("../../src/cli-commands/loop-yield-cmd.js");
    const { dispatchCliCommand } = await import("../../src/cli-commands/registry.js");

    const repo = await mkdtemp(join(tmpdir(), "ly-live-"));
    for (let i = 0; i < STALLED_THRESHOLD; i += 1) {
      await recordAndWarn(repo, { loop: "scout", project: "kunpeng", input: 1, yield: 0 });
    }
    expect((await loadLedger(repo)).rounds).toHaveLength(STALLED_THRESHOLD);

    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
    const prevExit = process.exitCode;
    let handled: boolean;
    try {
      handled = await dispatchCliCommand("loop-yield", { repoRoot: repo, flags: new Set(), args: [] } as never);
    } finally {
      console.log = orig;
    }

    expect(handled, "命令必须被 CLI 认出来").toBe(true);
    expect(lines.join("\n")).toContain("[告警]");
    expect(lines.join("\n")).toContain("空转");
    expect(process.exitCode, "有告警时退出码必须非 0").toBe(1);
    process.exitCode = prevExit;
  });

  test("反向：有产出时不告警，退出码保持 0", async () => {
    await import("../../src/cli-commands/loop-yield-cmd.js");
    const { dispatchCliCommand } = await import("../../src/cli-commands/registry.js");

    const repo = await mkdtemp(join(tmpdir(), "ly-live-"));
    for (let i = 0; i < STALLED_THRESHOLD + 2; i += 1) {
      await recordAndWarn(repo, { loop: "scout", project: "kunpeng", input: 1, yield: 5 });
    }

    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
    const prevExit = process.exitCode;
    try {
      await dispatchCliCommand("loop-yield", { repoRoot: repo, flags: new Set(), args: [] } as never);
    } finally {
      console.log = orig;
    }

    expect(lines.join("\n")).not.toContain("[告警]");
    expect(process.exitCode).toBe(prevExit);
  });
});
