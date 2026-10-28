import { execFile } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

/** 真合并与 LLM 预审一律替身：只记账，不碰任何真仓库、不调模型。 */
const spy = vi.hoisted(() => ({ merges: [] as string[], spawns: [] as string[][] }));

vi.mock("../../src/runtime/merge-gate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/runtime/merge-gate.js")>();
  return {
    ...actual,
    mergeAndClearGate: async (repoRoot: string, flowId: string) => {
      spy.merges.push(`${repoRoot}::${flowId}`);
      return { ok: true, note: "stub" };
    },
  };
});

vi.mock("../../src/server/pre-review.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/pre-review.js")>();
  return { ...actual, preReviewMerge: async () => ({ verdict: "approve", reason: "stub", at: 1 }) };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (cmd: string, args: string[]) => {
      spy.spawns.push([cmd, ...args]);
      return { unref() {}, on() {} };
    },
  };
});

import "../../src/server/routes/gate-actions.js";
import "../../src/cli-commands/loop-core.js";
import { dispatchCliCommand } from "../../src/cli-commands/registry.js";
import { dispatchModularRoute, type RouteContext } from "../../src/server/routes/registry.js";
import { AUTOPILOT_OPTOUT_REASON_PREFIX } from "../../src/loop/autopilot-optout.js";
import { loadLedger } from "../../src/metrics/loop-yield.js";
import { kunpengStateDir } from "../../src/project/registry.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

/** 真 git 仓：main 一份 lib/a.ts，kp/flow-x 改了它；flow-x 是 verified + 合并主干门；flow-c 是 crashed 且有检查点 tag。 */
async function makeRepo(marker?: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "kp-optout-wire-")));
  const git = (...args: string[]) => execFileAsync("git", args, { cwd: dir });
  await git("init", "-b", "main");
  await git("config", "user.email", "t@example.com");
  await git("config", "user.name", "t");
  await mkdir(join(dir, "lib"), { recursive: true });
  await writeFile(join(dir, "lib", "a.ts"), "export const a = 1;\n");
  await git("add", "lib/a.ts");
  await git("commit", "-m", "base");
  await git("checkout", "-b", "kp/flow-x");
  await writeFile(join(dir, "lib", "a.ts"), "export const a = 2;\n");
  await git("add", "lib/a.ts");
  await git("commit", "-m", "change");
  await git("checkout", "main");
  await git("tag", "kp-ckpt/flow-c-1");
  const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));
  await tracker.start("flow-x", "verified flow");
  await tracker.finish("flow-x", "verified", { gate: "合并主干 (人工门#1)", what: "kp/flow-x → main" });
  await tracker.start("flow-c", "crashed flow");
  await tracker.markCrashed("flow-c", "boom");
  if (marker !== undefined) await writeFile(join(dir, ".kunpeng", "autopilot-disabled"), marker);
  return dir;
}

async function gateOf(dir: string): Promise<unknown> {
  return (await new FlowTracker(join(dir, ".kunpeng", "state")).read("flow-x"))?.humanGate;
}

/** 停用仓不是 autopilot 的空转：本轮不许往它的 loop-yield 账本记 autopilot 轮次。 */
async function autopilotRoundsOf(dir: string): Promise<number> {
  return (await loadLedger(dir)).rounds.filter((round) => round.loop === "autopilot").length;
}

async function resumeAttemptsOf(dir: string): Promise<number> {
  return (await new FlowTracker(join(dir, ".kunpeng", "state")).read("flow-c"))?.resumeAttempts ?? 0;
}

/** 把注册表指向一个只含给定仓库的临时 KUNPENG_STATE，绝不扫到真实项目。 */
async function isolatedRegistry(repos: string[]): Promise<void> {
  const state = await realpath(await mkdtemp(join(tmpdir(), "kp-optout-state-")));
  process.env.KUNPENG_STATE = state;
  const projects = repos.map((repoPath, i) => ({ id: `p${i}`, name: `p${i}`, repoPath, registeredAt: 1 }));
  await writeFile(join(state, "projects.json"), JSON.stringify({ projects }));
  if (kunpengStateDir() !== state) throw new Error("KUNPENG_STATE 隔离失败，拒绝继续（否则会扫到真实项目）");
}

async function runCli(ctx: { repoArg?: string; rest?: string[]; flags?: string[] }): Promise<{ lines: string[]; exitCode: number | undefined }> {
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  const prevExit = process.exitCode;
  process.exitCode = undefined;
  let exitCode: number | undefined;
  try {
    const handled = await dispatchCliCommand("autopilot", {
      repoRoot: ctx.repoArg ?? process.cwd(),
      kunpengHome: process.cwd(),
      rest: ctx.rest ?? [],
      argv: [],
      flags: new Set(ctx.flags ?? []),
      ...(ctx.repoArg ? { repoArg: ctx.repoArg } : {}),
    });
    expect(handled).toBe(true);
  } finally {
    console.log = origLog;
    console.error = origErr;
    exitCode = typeof process.exitCode === "number" ? process.exitCode : undefined;
    process.exitCode = prevExit;
  }
  return { lines, exitCode };
}

async function postAutopilot(dir: string): Promise<Record<string, unknown>> {
  const req = Readable.from([Buffer.from(JSON.stringify({ projectId: "x" }))]) as unknown as IncomingMessage;
  let payload = "";
  const res = { setHeader() {}, end(chunk?: string) { payload = chunk ?? ""; } } as unknown as ServerResponse;
  const context: RouteContext = { stateDir: dir, repoRoot: dir };
  await dispatchModularRoute("POST", "/api/autopilot", req, res, context);
  return JSON.parse(payload) as Record<string, unknown>;
}

const savedState = process.env.KUNPENG_STATE;
const savedRepo = process.env.KUNPENG_REPO;
const savedTiers = process.env.KUNPENG_MERGE_TIERS;

beforeEach(() => {
  spy.merges.length = 0;
  spy.spawns.length = 0;
  delete process.env.KUNPENG_REPO;
  delete process.env.KUNPENG_MERGE_TIERS;
});

afterEach(() => {
  process.env.KUNPENG_STATE = savedState;
  if (savedRepo === undefined) delete process.env.KUNPENG_REPO; else process.env.KUNPENG_REPO = savedRepo;
  if (savedTiers === undefined) delete process.env.KUNPENG_MERGE_TIERS; else process.env.KUNPENG_MERGE_TIERS = savedTiers;
});

describe("生产调用方 1：驾驶舱 POST /api/autopilot", () => {
  it("对照组：无标记 → 照常合并 flow-x", async () => {
    const dir = await makeRepo();
    const body = await postAutopilot(dir);
    expect(body.ok).toBe(true);
    expect(body.merged).toEqual(["flow-x"]);
    expect(spy.merges).toEqual([`${dir}::flow-x`]);
  });

  it("有标记 → 零合并，flow-x 记 skipped 且 reason = 前缀 + 文件内容，门原样保留", async () => {
    const dir = await makeRepo("开悟须经签名门\n");
    const gateBefore = await gateOf(dir);
    const body = await postAutopilot(dir);
    expect(body.ok).toBe(true);
    expect(body.merged).toEqual([]);
    expect(body.rejected).toEqual([]);
    expect(body.skipped).toEqual([{ flowId: "flow-x", reason: AUTOPILOT_OPTOUT_REASON_PREFIX + "开悟须经签名门" }]);
    expect(spy.merges).toEqual([]);
    expect(gateBefore).toBeTruthy();
    expect(await gateOf(dir)).toEqual(gateBefore);
  });
});

describe("生产调用方 2：CLI 单仓 kunpeng autopilot --repo <path>", () => {
  it("对照组：无标记 → 合并 flow-x，并 resume crashed 的 flow-c", async () => {
    const dir = await makeRepo();
    await isolatedRegistry([]);
    const { exitCode } = await runCli({ repoArg: dir });
    expect(exitCode ?? 0).toBe(0);
    expect(spy.merges).toEqual([`${dir}::flow-x`]);
    expect(spy.spawns.some((args) => args.includes("resume") && args.includes("flow-c"))).toBe(true);
    expect(await resumeAttemptsOf(dir)).toBe(1);
    expect(await autopilotRoundsOf(dir)).toBe(1);
  });

  it("有标记 → 零合并、零 resume，输出里带停用原因，门原样保留", async () => {
    const dir = await makeRepo("开悟永久排除");
    await isolatedRegistry([]);
    const gateBefore = await gateOf(dir);
    const { lines, exitCode } = await runCli({ repoArg: dir });
    expect(exitCode ?? 0).toBe(0);
    expect(spy.merges).toEqual([]);
    expect(spy.spawns).toEqual([]);
    expect(await resumeAttemptsOf(dir)).toBe(0);
    expect(await gateOf(dir)).toEqual(gateBefore);
    expect(lines.join("\n")).toContain(AUTOPILOT_OPTOUT_REASON_PREFIX + "开悟永久排除");
    expect(await autopilotRoundsOf(dir)).toBe(0);
  });
});

describe("生产调用方 3：CLI 多仓扫描（runMultiRepoAutopilot → runOneRepo）", () => {
  it("同一轮里：有标记的仓零合并零 resume，无标记的仓照常合并与 resume", async () => {
    const off = await makeRepo("停用");
    const on = await makeRepo();
    await isolatedRegistry([off, on]);
    const { lines, exitCode } = await runCli({});
    expect(exitCode ?? 0).toBe(0);
    expect(spy.merges).toEqual([`${on}::flow-x`]);
    expect(spy.spawns.filter((args) => args.includes(off))).toEqual([]);
    expect(spy.spawns.some((args) => args.includes("resume") && args.includes(on))).toBe(true);
    expect(await resumeAttemptsOf(off)).toBe(0);
    expect(await autopilotRoundsOf(off)).toBe(0);
    expect(await autopilotRoundsOf(on)).toBe(1);
    expect(lines.join("\n")).toContain(AUTOPILOT_OPTOUT_REASON_PREFIX + "停用");
  });
});

describe("kunpeng autopilot 拒绝未知子命令/多余参数，且不执行合并", () => {
  it("autopilot status → 退出码 1，零合并零 resume，输出点名 status", async () => {
    const dir = await makeRepo();
    await isolatedRegistry([dir]);
    const { lines, exitCode } = await runCli({ rest: ["status"] });
    expect(exitCode).toBe(1);
    expect(spy.merges).toEqual([]);
    expect(spy.spawns).toEqual([]);
    expect(lines.join("\n")).toContain("status");
  });

  it("位置参数（哪怕是个仓库路径）同样拒绝，不会退化成扫全部项目", async () => {
    const dir = await makeRepo();
    await isolatedRegistry([dir]);
    const { exitCode } = await runCli({ rest: [dir] });
    expect(exitCode).toBe(1);
    expect(spy.merges).toEqual([]);
  });

  it("--dry-run 之类 autopilot 不认识的开关同样拒绝", async () => {
    const dir = await makeRepo();
    await isolatedRegistry([dir]);
    const { exitCode } = await runCli({ flags: ["--dry-run"] });
    expect(exitCode).toBe(1);
    expect(spy.merges).toEqual([]);
  });
});