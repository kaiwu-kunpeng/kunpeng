import { describe, it, expect } from "vitest";
import { toAgentCard, pickByCapability, type AgentCard, type AgentSkill } from "../../src/switchboard/agent-card.js";
import type { Heartbeat } from "../../src/switchboard/presence.js";

const hb = (o: Partial<Heartbeat> & Pick<Heartbeat, "instance" | "ts">): Heartbeat => ({ ...o });
const skill = (id: string, tags?: string[]): AgentSkill => ({ id, ...(tags ? { tags } : {}) });

describe("toAgentCard 合成卡", () => {
  it("在线窗内 online=true, 带 skills 与 meta", () => {
    const c = toAgentCard(hb({ instance: "main", ts: 1000, projectId: "kunpeng", task: "建任务" }), {
      now: 1000 + 30_000, skills: [skill("claude"), skill("vision")],
    });
    expect(c.name).toBe("main");
    expect(c.online).toBe(true);
    expect(c.lastSeen).toBe(1000);
    expect(c.skills.map((s) => s.id)).toEqual(["claude", "vision"]);
    expect(c.projectId).toBe("kunpeng");
    expect(c.task).toBe("建任务");
  });

  it("超出在线窗 → online=false; 无 skills → []", () => {
    const c = toAgentCard(hb({ instance: "old", ts: 0 }), { now: 200_000 });
    expect(c.online).toBe(false);
    expect(c.skills).toEqual([]);
    expect(c.projectId).toBeUndefined();
  });
});

describe("pickByCapability 按能力筛", () => {
  const cards: AgentCard[] = [
    { name: "a", online: true, lastSeen: 1, skills: [{ id: "claude", tags: ["vision"] }] },
    { name: "b", online: false, lastSeen: 1, skills: [{ id: "codex" }] },
    { name: "c", online: true, lastSeen: 1, skills: [{ id: "codex" }] },
  ];
  it("按 skill id 命中", () => {
    expect(pickByCapability(cards, "codex").map((c) => c.name)).toEqual(["b", "c"]);
  });
  it("按 tag 命中", () => {
    expect(pickByCapability(cards, "vision").map((c) => c.name)).toEqual(["a"]);
  });
  it("onlineOnly 只留在线", () => {
    expect(pickByCapability(cards, "codex", { onlineOnly: true }).map((c) => c.name)).toEqual(["c"]);
  });
  it("无人命中 → []", () => {
    expect(pickByCapability(cards, "nope")).toEqual([]);
  });
});
