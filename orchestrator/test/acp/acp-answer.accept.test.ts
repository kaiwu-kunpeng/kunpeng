import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createAcpAgent, formatFlowStatus, type AcpDeps } from "../../src/acp/agent.js";
import { answerRaisedBlocker } from "../../src/acp/answer.js";
import { resolveProjectStateDir } from "../../src/project/state-resolve.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { isPauseRequested, requestPause } from "../../src/runtime/pause-marker.js";
import { RAISE_BLOCKER_PREFIX } from "../../src/runtime/raise-blocker.js";
import { readFeedback } from "../../src/runtime/review-feedback.js";

let repo: string;
let launches: Array<{ args: string[]; cwd: string }>;
const launch = (args: string[], cwd: string) => { launches.push({ args, cwd }); return { pid: 777, logPath: "/logs/resume.log" }; };

beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-acp-answer-")); launches = []; });
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

async function seed(flowId: string, blocker?: string) {
  const tracker = new FlowTracker(resolveProjectStateDir(repo));
  await tracker.start(flowId, "需求");
  if (blocker) {
    await tracker.block(flowId, blocker);
    await tracker.markStopped(flowId);
  }
}

describe("answerRaisedBlocker：写回复 → 清暂停 → 续跑（作者锁定）", () => {
  test("agent 主动求助的流：回复落进审查意见、暂停标记清掉、以 resume 参数续跑", async () => {
    await seed("f-help", `${RAISE_BLOCKER_PREFIX}缺 STRIPE_KEY`);
    await requestPause(repo, "f-help");
    const out = await answerRaisedBlocker(repo, "f-help", "  用测试 key sk_test_x  ", { launch });
    expect(out.ok).toBe(true);
    expect(out.message).toContain("777");
    expect(await readFeedback(repo, "f-help")).toEqual([{ comment: "用测试 key sk_test_x" }]);
    expect(await isPauseRequested(repo, "f-help")).toBe(false);
    expect(launches).toEqual([{ args: ["resume", "f-help", "--repo", repo], cwd: repo }]);
  });

  test("不是 agent 求助的卡点、不存在的流、空回复 → 不续跑，说明原因", async () => {
    await seed("f-crash", "dev-cycle 异常: boom");
    const notHelp = await answerRaisedBlocker(repo, "f-crash", "随便", { launch });
    expect(notHelp).toEqual({ ok: false, message: "f-crash 当前没有等待答复的求助" });
    expect((await answerRaisedBlocker(repo, "ghost", "x", { launch })).message).toContain("没有这条流");
    expect((await answerRaisedBlocker(repo, "f-crash", "   ", { launch })).message).toBe("回复不能为空");
    expect(launches).toEqual([]);
    expect(await readFeedback(repo, "f-crash")).toEqual([]);
  });
});

describe("ACP 会话里的 /answer 与 /status 提示（作者锁定）", () => {
  function harness(answer?: AcpDeps["answerBlocker"]) {
    const sent: Array<Record<string, unknown>> = [];
    const deps: AcpDeps = {
      version: "1",
      newSessionId: () => "s",
      listFlows: async () => [
        { flowId: "f-help", status: "stopped", stage: "implement", updatedAt: 2, blocker: "缺 STRIPE_KEY", raisedBlocker: true },
        { flowId: "f-done", status: "verified", stage: "done", updatedAt: 1 },
      ],
      dispatch: async () => ({ pid: 0, logPath: "" }),
      ...(answer ? { answerBlocker: answer } : {}),
    };
    const agent = createAcpAgent(deps, (m) => sent.push(m));
    const call = (id: number, method: string, params: unknown) => agent.handle(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    const lastText = () => {
      const updates = sent.filter((m) => m.method === "session/update").map((m) => ((m.params as { update: { content?: { text?: string } } }).update.content?.text)).filter(Boolean);
      return updates.at(-1) ?? "";
    };
    return { sent, call, lastText };
  }

  test("session/new 推送的斜杠命令含 answer", async () => {
    const h = harness();
    await h.call(1, "session/new", { cwd: "/repo", mcpServers: [] });
    const update = (h.sent[1]!.params as { update: { availableCommands: Array<{ name: string }> } }).update;
    expect(update.availableCommands.map((c) => c.name)).toEqual(["run", "status", "answer"]);
  });

  test("/answer <flowId> <回复> 调到 answerBlocker，回复可以含空格与换行", async () => {
    const calls: Array<[string, string, string]> = [];
    const h = harness(async (cwd, flowId, reply) => { calls.push([cwd, flowId, reply]); return { ok: true, message: "已答复并续跑 f-help" }; });
    await h.call(1, "session/new", { cwd: "/repo", mcpServers: [] });
    await h.call(2, "session/prompt", { sessionId: "s", prompt: [{ type: "text", text: "/answer f-help 用测试 key\n别用生产 key" }] });
    expect(calls).toEqual([["/repo", "f-help", "用测试 key\n别用生产 key"]]);
    expect(h.lastText()).toBe("已答复并续跑 f-help");
    expect(h.sent.at(-1)).toEqual({ jsonrpc: "2.0", id: 2, result: { stopReason: "end_turn" } });
  });

  test("/answer 失败原因转述；缺参数给用法；实例不支持时明说", async () => {
    const h = harness(async () => ({ ok: false, message: "f-x 当前没有等待答复的求助" }));
    await h.call(1, "session/new", { cwd: "/repo", mcpServers: [] });
    await h.call(2, "session/prompt", { sessionId: "s", prompt: [{ type: "text", text: "/answer f-x 好" }] });
    expect(h.lastText()).toBe("没有续跑：f-x 当前没有等待答复的求助");
    await h.call(3, "session/prompt", { sessionId: "s", prompt: [{ type: "text", text: "/answer f-x" }] });
    expect(h.lastText()).toContain("用法");
    const bare = harness();
    await bare.call(1, "session/new", { cwd: "/repo", mcpServers: [] });
    await bare.call(2, "session/prompt", { sessionId: "s", prompt: [{ type: "text", text: "/answer f-help 好" }] });
    expect(bare.lastText()).toContain("不支持");
  });

  test("/status 给求助中的流附上 /answer 提示，其它流不附", () => {
    const text = formatFlowStatus([
      { flowId: "f-help", status: "stopped", stage: "implement", updatedAt: 2, blocker: "缺 STRIPE_KEY", raisedBlocker: true },
      { flowId: "f-done", status: "verified", stage: "done", updatedAt: 1 },
    ]);
    const [first, second] = text.split("\n");
    expect(first).toContain("用 /answer f-help <回复> 答复");
    expect(second).not.toContain("/answer");
  });
});