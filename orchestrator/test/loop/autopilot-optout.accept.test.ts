import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_OPTOUT_DEFAULT_TEXT,
  AUTOPILOT_OPTOUT_FILE,
  AUTOPILOT_OPTOUT_REASON_PREFIX,
  readAutopilotOptOut,
} from "../../src/loop/autopilot-optout.js";
import { runAutopilot, type AutopilotDeps } from "../../src/loop/autopilot.js";
import type { FlowState, FlowTracker } from "../../src/runtime/flowstate.js";
import { classifySensitiveFiles } from "../../src/runtime/sensitive-paths.js";

const execFileAsync = promisify(execFile);

function gated(flowId: string): FlowState {
  return {
    flowId,
    requirement: "req " + flowId,
    stage: "done",
    status: "verified",
    agentActive: false,
    humanGate: { gate: "合并主干 (人工门#1)", what: `kp/${flowId} → main` },
    startedAt: 1,
    updatedAt: 2,
    history: [],
  } as FlowState;
}

/** 记录 tracker 上一切写操作；停用时它们一次都不许被调用。 */
function recordingTracker(flows: FlowState[]) {
  const writes: string[] = [];
  const tracker = {
    list: async () => flows,
    read: async (id: string) => flows.find((f) => f.flowId === id) ?? null,
    markSensitive: async () => { writes.push("markSensitive"); },
    setMergeTier: async () => { writes.push("setMergeTier"); },
    setGateHold: async () => { writes.push("setGateHold"); },
    setGatePreReview: async () => { writes.push("setGatePreReview"); },
    clearGate: async () => { writes.push("clearGate"); },
    setResumeAttempts: async () => { writes.push("setResumeAttempts"); },
  } as unknown as FlowTracker;
  return { tracker, writes };
}

/** 全部闸都接上且都会「放行」，并逐个记账被调用的闸。 */
function fullDeps(tracker: FlowTracker, calls: string[]): AutopilotDeps {
  return {
    tracker,
    merge: async (flowId) => { calls.push("merge:" + flowId); return { ok: true }; },
    futile: async () => { calls.push("futile"); return { futile: false }; },
    discard: async () => { calls.push("discard"); },
    sensitive: async () => { calls.push("sensitive"); return { hits: [] }; },
    publicSurface: async () => { calls.push("publicSurface"); return { touched: false }; },
    preReview: async () => { calls.push("preReview"); return { verdict: "approve", reason: "ok" }; },
    tier: async () => { calls.push("tier"); return { tier: "auto", reasons: [], ruleIds: [], mode: "report" }; },
    log: () => {},
  } as AutopilotDeps;
}

async function tmpRepo(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "kp-optout-")));
}

async function writeMarker(root: string, content: string): Promise<void> {
  await mkdir(join(root, ".kunpeng"), { recursive: true });
  await writeFile(join(root, AUTOPILOT_OPTOUT_FILE), content);
}

describe("停用判定模块本身是守门器源码（改它的流永不自动合并）", () => {
  it.each(["src/loop/autopilot-optout.ts", "orchestrator/src/loop/autopilot-optout.ts"])("%s → 守门器源码", (file) => {
    expect(classifySensitiveFiles([file]).hits.map((hit) => hit.label)).toContain("守门器源码");
  });
});

describe("readAutopilotOptOut：标记文件存在即停用", () => {
  it("常量钉死：路径、前缀、默认文案", () => {
    expect(AUTOPILOT_OPTOUT_FILE).toBe(".kunpeng/autopilot-disabled");
    expect(AUTOPILOT_OPTOUT_REASON_PREFIX).toBe("autopilot 已对本仓停用：");
    expect(AUTOPILOT_OPTOUT_DEFAULT_TEXT).toBe("仓库存在 .kunpeng/autopilot-disabled 标记");
  });

  it("没有标记 → 不停用（连 .kunpeng 目录都没有也一样）", async () => {
    const dir = await tmpRepo();
    expect(await readAutopilotOptOut(dir)).toEqual({ disabled: false });
    await mkdir(join(dir, ".kunpeng"), { recursive: true });
    expect(await readAutopilotOptOut(dir)).toEqual({ disabled: false });
  });

  it("有标记且有内容 → 停用，reason = 前缀 + 内容（空白折叠、去首尾）", async () => {
    const dir = await tmpRepo();
    await writeMarker(dir, "  开悟所有合并须经主 agent 审查\n与签名门  \n");
    expect(await readAutopilotOptOut(dir)).toEqual({
      disabled: true,
      reason: "autopilot 已对本仓停用：开悟所有合并须经主 agent 审查 与签名门",
    });
  });

  it("空标记 → 停用，reason = 前缀 + 默认文案", async () => {
    const dir = await tmpRepo();
    await writeMarker(dir, "   \n");
    expect(await readAutopilotOptOut(dir)).toEqual({
      disabled: true,
      reason: "autopilot 已对本仓停用：仓库存在 .kunpeng/autopilot-disabled 标记",
    });
  });

  it("超长内容截到 200 字并以 … 收尾", async () => {
    const dir = await tmpRepo();
    await writeMarker(dir, "长".repeat(500));
    const v = await readAutopilotOptOut(dir);
    expect(v.disabled).toBe(true);
    if (!v.disabled) throw new Error("unreachable");
    expect(v.reason).toBe(AUTOPILOT_OPTOUT_REASON_PREFIX + "长".repeat(200) + "…");
  });

  it("标记是个目录（存在但不是文件）→ 仍按停用，用默认文案", async () => {
    const dir = await tmpRepo();
    await mkdir(join(dir, ".kunpeng", "autopilot-disabled"), { recursive: true });
    expect(await readAutopilotOptOut(dir)).toEqual({
      disabled: true,
      reason: AUTOPILOT_OPTOUT_REASON_PREFIX + AUTOPILOT_OPTOUT_DEFAULT_TEXT,
    });
  });

  it("标记判不定（.kunpeng 目录不可访问 → EACCES）→ 保守按停用，reason 点名错误码", async () => {
    const dir = await tmpRepo();
    await writeMarker(dir, "x");
    await chmod(join(dir, ".kunpeng"), 0o000);
    try {
      const v = await readAutopilotOptOut(dir);
      expect(v.disabled).toBe(true);
      if (!v.disabled) throw new Error("unreachable");
      expect(v.reason.startsWith(AUTOPILOT_OPTOUT_REASON_PREFIX)).toBe(true);
      expect(v.reason).toContain("EACCES");
    } finally {
      await chmod(join(dir, ".kunpeng"), 0o755);
    }
  });

  it("从同仓的 git worktree 路径调用，也认主检出里的标记", async () => {
    const dir = await tmpRepo();
    const git = (...args: string[]) => execFileAsync("git", args, { cwd: dir });
    await git("init", "-b", "main");
    await git("config", "user.email", "t@example.com");
    await git("config", "user.name", "t");
    await writeFile(join(dir, "a.txt"), "a\n");
    await git("add", "a.txt");
    await git("commit", "-m", "base");
    const wt = join(await tmpRepo(), "wt");
    await git("worktree", "add", "--detach", wt, "main");
    expect(await readAutopilotOptOut(wt)).toEqual({ disabled: false });
    await writeMarker(dir, "主检出停用");
    expect(await readAutopilotOptOut(wt)).toEqual({ disabled: true, reason: AUTOPILOT_OPTOUT_REASON_PREFIX + "主检出停用" });
  });
});

describe("runAutopilot：optOut 判停用 → 本仓零合并、零驳回、零闸、零门写", () => {
  it("两条候选全部 skipped，reason 逐字等于 optOut.reason，任何闸与 tracker 写都没被调用", async () => {
    const { tracker, writes } = recordingTracker([gated("a"), gated("b")]);
    const calls: string[] = [];
    const reason = AUTOPILOT_OPTOUT_REASON_PREFIX + "开悟须经签名门";
    const result = await runAutopilot({ ...fullDeps(tracker, calls), optOut: async () => ({ disabled: true, reason }) });
    expect(result.merged).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.skipped).toEqual([
      { flowId: "a", reason },
      { flowId: "b", reason },
    ]);
    expect(result.optedOut).toEqual({ reason });
    expect(calls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("即使 futile 会判过不去，停用仓也不驳回、不 discard", async () => {
    const { tracker, writes } = recordingTracker([gated("empty")]);
    const calls: string[] = [];
    const deps = fullDeps(tracker, calls);
    const result = await runAutopilot({
      ...deps,
      futile: async () => { calls.push("futile"); return { futile: true, reason: "空改动" }; },
      optOut: async () => ({ disabled: true, reason: AUTOPILOT_OPTOUT_REASON_PREFIX + "x" }),
    });
    expect(result.rejected).toEqual([]);
    expect(result.skipped.map((s) => s.flowId)).toEqual(["empty"]);
    expect(calls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("optOut 自身抛错 → 保守按停用（fail-closed），reason 以前缀开头", async () => {
    const { tracker } = recordingTracker([gated("a")]);
    const calls: string[] = [];
    const result = await runAutopilot({
      ...fullDeps(tracker, calls),
      optOut: async () => { throw new Error("EACCES"); },
    });
    expect(result.merged).toEqual([]);
    expect(calls).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason.startsWith(AUTOPILOT_OPTOUT_REASON_PREFIX)).toBe(true);
    expect(result.skipped[0].reason).toContain("EACCES");
    expect(result.optedOut?.reason).toBe(result.skipped[0].reason);
  });

  it("optOut 判不停用 → 行为与不接 optOut 逐字相同（照常合并，结果里没有 optedOut 键）", async () => {
    const run = async (withOptOut: boolean) => {
      const { tracker } = recordingTracker([gated("a"), gated("b")]);
      const calls: string[] = [];
      const deps = fullDeps(tracker, calls);
      const result = await runAutopilot(withOptOut ? { ...deps, optOut: async () => ({ disabled: false }) } : deps);
      return { result, calls };
    };
    const off = await run(false);
    const on = await run(true);
    expect(on).toEqual(off);
    expect(on.result.merged).toEqual(["a", "b"]);
    expect("optedOut" in on.result).toBe(false);
    expect(on.calls).toContain("merge:a");
  });

  it("停用时只把真候选（verified + 合并主干门）记 skipped，其它流不出现", async () => {
    const running = { ...gated("r"), status: "running" } as FlowState;
    const noGate = { ...gated("n"), humanGate: undefined } as FlowState;
    const { tracker } = recordingTracker([gated("a"), running, noGate]);
    const result = await runAutopilot({
      ...fullDeps(tracker, []),
      optOut: async () => ({ disabled: true, reason: AUTOPILOT_OPTOUT_REASON_PREFIX + "x" }),
    });
    expect(result.skipped.map((s) => s.flowId)).toEqual(["a"]);
  });
});