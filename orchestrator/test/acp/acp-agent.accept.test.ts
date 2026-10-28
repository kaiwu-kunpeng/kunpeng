import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { ACP_PROTOCOL_VERSION, createAcpAgent, extractAcceptBlock, formatFlowStatus, runAcpStdio, type AcpDeps } from "../../src/acp/agent.js";
import "../../src/cli.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";

const F = "`".repeat(3);
const SPEC_OK = `# 修登录超时\n正文\n\n${F}scope\nallow: a.ts\n${F}\n\n${F}accept\ncd orchestrator && npx vitest run test/a.test.ts\n${F}\n`;
const SPEC_NO_ACCEPT = `# 没验收\n正文\n`;

type Msg = Record<string, unknown> & { id?: unknown; result?: Record<string, unknown>; error?: { code: number; message: string }; method?: string; params?: Record<string, unknown> };

function harness(overrides: Partial<AcpDeps> = {}) {
  const sent: Msg[] = [];
  const dispatched: Array<{ cwd: string; specPath: string; acceptCmd: string }> = [];
  const files: Record<string, string> = { "/repo/docs/specs/ok.md": SPEC_OK, "/repo/docs/specs/bad.md": SPEC_NO_ACCEPT };
  const deps: AcpDeps = {
    version: "9.9.9",
    newSessionId: () => "sess-1",
    readFile: (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT ${path}`);
      return content;
    },
    listFlows: async () => [
      { flowId: "old-flow", status: "verified", stage: "done", updatedAt: 1 },
      { flowId: "stuck-flow", status: "running", stage: "implement", updatedAt: 5, blocker: "缺凭据" },
      { flowId: "gated-flow", status: "verified", stage: "done", updatedAt: 3, gate: "合并主干 (人工门#1)" },
    ],
    dispatch: async (cwd, specPath, acceptCmd) => { dispatched.push({ cwd, specPath, acceptCmd }); return { pid: 4242, logPath: "/repo/.kunpeng/cockpit/logs/run-x.log" }; },
    ...overrides,
  };
  const agent = createAcpAgent(deps, (m) => sent.push(m as Msg));
  const call = async (id: number, method: string, params?: unknown) => { await agent.handle(JSON.stringify({ jsonrpc: "2.0", id, method, params })); };
  const texts = () => sent.filter((m) => m.method === "session/update")
    .map((m) => (m.params?.update as { content?: { text?: string } } | undefined)?.content?.text)
    .filter((t): t is string => typeof t === "string");
  return { sent, dispatched, call, texts, agent };
}

async function openSession(h: ReturnType<typeof harness>) {
  await h.call(0, "initialize", { protocolVersion: 1, clientCapabilities: {} });
  await h.call(1, "session/new", { cwd: "/repo", mcpServers: [] });
}

describe("ACP v1 握手（作者锁定）", () => {
  test("initialize：协议版本 1、不需认证、不支持 loadSession、带 agentInfo", async () => {
    const h = harness();
    await h.call(0, "initialize", { protocolVersion: 2, clientCapabilities: {} });
    expect(ACP_PROTOCOL_VERSION).toBe(1);
    expect(h.sent[0]).toEqual({
      jsonrpc: "2.0", id: 0,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: false, promptCapabilities: { image: false, audio: false, embeddedContext: false }, mcpCapabilities: { http: false, sse: false } },
        authMethods: [],
        agentInfo: { name: "kunpeng", title: "鲲鹏", version: "9.9.9" },
      },
    });
  });

  test("session/new：回 sessionId，随后推送 run/status/answer 三个斜杠命令；cwd 非绝对路径 → -32602", async () => {
    const h = harness();
    await openSession(h);
    expect(h.sent[1]).toEqual({ jsonrpc: "2.0", id: 1, result: { sessionId: "sess-1" } });
    const cmds = h.sent[2]!;
    expect(cmds.method).toBe("session/update");
    const update = cmds.params?.update as { sessionUpdate: string; availableCommands: Array<{ name: string }> };
    expect(update.sessionUpdate).toBe("available_commands_update");
    expect(update.availableCommands.map((c) => c.name)).toEqual(["run", "status", "answer"]);
    await h.call(9, "session/new", { cwd: "relative/dir", mcpServers: [] });
    expect(h.sent.at(-1)?.error?.code).toBe(-32602);
  });

  test("未知方法 → -32601；坏 JSON → -32700；通知（含 session/cancel）不回响应；未知会话 → -32602", async () => {
    const h = harness();
    await h.call(3, "session/load", { sessionId: "x" });
    expect(h.sent.at(-1)?.error?.code).toBe(-32601);
    await h.agent.handle("{不是 json");
    expect(h.sent.at(-1)).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    const before = h.sent.length;
    await h.agent.handle(JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "sess-1" } }));
    expect(h.sent.length).toBe(before);
    await h.call(4, "session/prompt", { sessionId: "nope", prompt: [{ type: "text", text: "/status" }] });
    expect(h.sent.at(-1)?.error?.code).toBe(-32602);
  });
});

describe("斜杠命令（作者锁定）", () => {
  test("/status：按更新时间倒序列出流，带卡点与门；turn 以 end_turn 结束", async () => {
    const h = harness();
    await openSession(h);
    await h.call(2, "session/prompt", { sessionId: "sess-1", prompt: [{ type: "text", text: "/status" }] });
    const text = h.texts().at(-1)!;
    expect(text.split("\n")[0]).toContain("stuck-flow");
    expect(text).toContain("卡点：缺凭据");
    expect(text).toContain("门：合并主干 (人工门#1)");
    expect(text.indexOf("gated-flow")).toBeLessThan(text.indexOf("old-flow"));
    expect(h.sent.at(-1)).toEqual({ jsonrpc: "2.0", id: 2, result: { stopReason: "end_turn" } });
  });

  test("/run <spec 绝对路径>：抽出 accept 块派流，回报 pid 与日志", async () => {
    const h = harness();
    await openSession(h);
    await h.call(2, "session/prompt", { sessionId: "sess-1", prompt: [{ type: "text", text: "/run /repo/docs/specs/ok.md" }] });
    expect(h.dispatched).toEqual([{ cwd: "/repo", specPath: "/repo/docs/specs/ok.md", acceptCmd: "cd orchestrator && npx vitest run test/a.test.ts" }]);
    expect(h.texts().at(-1)).toContain("4242");
    expect(h.sent.at(-1)?.result).toEqual({ stopReason: "end_turn" });
  });

  test("/run 也接受拖进来的 .md 文件引用（resource_link）", async () => {
    const h = harness();
    await openSession(h);
    await h.call(2, "session/prompt", { sessionId: "sess-1", prompt: [{ type: "text", text: "/run" }, { type: "resource_link", uri: "file:///repo/docs/specs/ok.md", name: "ok.md" }] });
    expect(h.dispatched.map((d) => d.specPath)).toEqual(["/repo/docs/specs/ok.md"]);
  });

  test("/run 拒绝：一句话需求、缺 accept 块、读不到文件 —— 都不派流且说明原因", async () => {
    const h = harness();
    await openSession(h);
    await h.call(2, "session/prompt", { sessionId: "sess-1", prompt: [{ type: "text", text: "/run 修复登录超时" }] });
    expect(h.texts().at(-1)).toContain("绝对路径");
    await h.call(3, "session/prompt", { sessionId: "sess-1", prompt: [{ type: "text", text: "/run /repo/docs/specs/bad.md" }] });
    expect(h.texts().at(-1)).toContain("缺少 accept 块");
    await h.call(4, "session/prompt", { sessionId: "sess-1", prompt: [{ type: "text", text: "/run /repo/docs/specs/ghost.md" }] });
    expect(h.texts().at(-1)).toContain("读不到");
    expect(h.dispatched).toEqual([]);
  });

  test("其它输入 → 帮助文案", async () => {
    const h = harness();
    await openSession(h);
    await h.call(2, "session/prompt", { sessionId: "sess-1", prompt: [{ type: "text", text: "你好" }] });
    expect(h.texts().at(-1)).toContain("/status");
    expect(h.texts().at(-1)).toContain("/run");
  });
});

describe("工具函数与接线（作者锁定）", () => {
  test("extractAcceptBlock / formatFlowStatus", () => {
    expect(extractAcceptBlock(SPEC_OK)).toBe("cd orchestrator && npx vitest run test/a.test.ts");
    expect(extractAcceptBlock(SPEC_NO_ACCEPT)).toBeUndefined();
    expect(formatFlowStatus([])).toContain("没有流");
  });

  test("stdio：按行分帧，一条消息被拆成两块到达也能解析；每条输出一行 JSON", async () => {
    const input = new PassThrough();
    const lines: string[] = [];
    const output = { write: (chunk: string) => { lines.push(chunk); return true; } };
    const done = runAcpStdio(input, output, { version: "1.0.0", listFlows: async () => [], dispatch: async () => ({ pid: 0, logPath: "" }), newSessionId: () => "s" });
    const init = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: 1 } });
    input.write(init.slice(0, 10));
    input.write(`${init.slice(10)}\n`);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/repo", mcpServers: [] } })}\n`);
    input.end();
    await done;
    expect(lines.every((l) => l.endsWith("\n") && l.indexOf("\n") === l.length - 1)).toBe(true);
    const parsed = lines.map((l) => JSON.parse(l) as Msg);
    expect(parsed[0]?.result?.protocolVersion).toBe(1);
    expect(parsed[1]?.result).toEqual({ sessionId: "s" });
    expect(parsed[2]?.method).toBe("session/update");
  });

  test("kunpeng acp 命令已注册", () => {
    expect(listCliCommands().map((c) => c.name)).toContain("acp");
  });
});