import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleMcpRequest, TOOL_DEFS, type JsonRpcRequest } from "../../src/switchboard/mcp-server.js";
import { TaskStore } from "../../src/switchboard/task-store.js";
import { PresenceStore } from "../../src/switchboard/presence.js";
import { resolveSkills, cardsFromHeartbeats } from "../../src/switchboard/agent-card.js";
import type { Heartbeat } from "../../src/switchboard/presence.js";

let dir: string;
let taskStore: TaskStore;
let presence: PresenceStore;
const NOW = 1_700_000_000_000;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kp-agentcard-"));
  taskStore = new TaskStore(dir);
  presence = new PresenceStore(join(dir, "presence"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const req = (method: string, params?: unknown, id: number | string = 1): JsonRpcRequest => ({ jsonrpc: "2.0", id, method, params });
type ToolListResult = { tools: Array<{ name: string }> };
type ToolCallResult = { content: Array<{ text: string }> };
type AgentCardResult = { name: string; online: boolean; skills: Array<{ id: string }> };

describe("resolveSkills", () => {
  it("env CSV + 探测旗标合并去重", () => {
    expect(resolveSkills({ env: "vision, web ,vision", hasCodex: true })).toEqual(["vision", "web", "codex"]);
    expect(resolveSkills({})).toEqual([]);
  });
});

describe("cardsFromHeartbeats", () => {
  it("心跳的 skills 映射成 AgentSkill, online 按 now 算", () => {
    const hbs: Heartbeat[] = [{ instance: "w", ts: NOW, skills: ["codex"] }];
    const cards = cardsFromHeartbeats(hbs, { now: NOW + 1000 });
    expect(cards[0].online).toBe(true);
    expect(cards[0].skills).toEqual([{ id: "codex" }]);
  });
});

describe("agent_card MCP 工具真往返", () => {
  it("tools/list 含 agent_card", async () => {
    const r = await handleMcpRequest(req("tools/list"), { taskStore });
    expect((r?.result as ToolListResult).tools.map((tool) => tool.name)).toContain("agent_card");
    expect(TOOL_DEFS.some((t) => t.name === "agent_card")).toBe(true);
  });

  it("beat 带 skills → agent_card 返回带 skills 的在线卡", async () => {
    await presence.beat("worker-1", NOW, { skills: ["codex", "vision"] });
    const r = await handleMcpRequest(req("tools/call", { name: "agent_card", arguments: {} }), { taskStore, presence, now: () => NOW + 5_000 });
    const cards = JSON.parse((r?.result as ToolCallResult).content[0].text) as AgentCardResult[];
    const w = cards.find((card) => card.name === "worker-1");
    expect(w).toBeTruthy();
    if (!w) throw new Error("worker-1 card missing");
    expect(w.online).toBe(true);
    expect(w.skills.map((skill) => skill.id)).toEqual(["codex", "vision"]);
  });

  it("无 presence → agent_card 返回 []", async () => {
    const r = await handleMcpRequest(req("tools/call", { name: "agent_card", arguments: {} }), { taskStore });
    expect(JSON.parse((r?.result as ToolCallResult).content[0].text)).toEqual([]);
  });
});
