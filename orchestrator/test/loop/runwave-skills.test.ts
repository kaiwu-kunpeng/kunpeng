import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoopDef } from "../../src/loop/types.js";
import { runAgentPlaybookWave, type AgentPlaybookDeps } from "../../src/loop/recipes/agent-playbook/runwave.js";

function loopDef(): LoopDef {
  return {
    id: "l1", name: "L1", projectId: "p1", recipe: "agent-playbook",
    metric: { key: "m", label: "M", current: 7 },
    levers: [{ id: "card-a", label: "卡A", status: "active" }],
    waves: [], createdAt: 1, updatedAt: 1,
  };
}

function body(steps: unknown[]): string {
  return ["```aop", JSON.stringify({ goal: "目标", steps }), "```"].join("\n");
}

function deps(ran: string[], skills: string[] | undefined, skillMap: Record<string, string>): AgentPlaybookDeps {
  return {
    repoPath: mkdtempSync(join(tmpdir(), "kp-apbs-")),
    runner: { async runStep(prompt: string) { ran.push(prompt); } },
    loadPlaybook: async () => ({ body: body([{ id: "s1", prompt: "做A" }]), ...(skills ? { skills } : {}) }),
    loadSkill: async (id: string) => skillMap[id],
    execAssert: async () => 0,
  };
}

describe("执行器注入技能前言", () => {
  it("声明技能 → 每步 prompt 以技能正文开头", async () => {
    const ran: string[] = [];
    const r = await runAgentPlaybookWave(loopDef(), "card-a", undefined,
      deps(ran, ["geo-audit"], { "geo-audit": "先查收录再查引用" }));
    expect(r.verified).toBe(true);
    expect(ran.length).toBe(1);
    expect(ran[0]).toContain("【技能·geo-audit】");
    expect(ran[0]).toContain("先查收录再查引用");
    expect(ran[0].indexOf("【技能·geo-audit】")).toBeLessThan(ran[0].indexOf("目标:"));
  });

  it("声明了未注册技能 → 整浪失败,gotcha 点名技能 id,一步不跑", async () => {
    const ran: string[] = [];
    const r = await runAgentPlaybookWave(loopDef(), "card-a", undefined,
      deps(ran, ["ghost-skill"], {}));
    expect(r.verified).toBe(false);
    expect(ran.length).toBe(0);
    expect((r.gotchas ?? []).join(" ")).toContain("ghost-skill");
  });

  it("无技能声明 → prompt 与现状一致(不带技能前言,不以换行开头)", async () => {
    const ran: string[] = [];
    const r = await runAgentPlaybookWave(loopDef(), "card-a", undefined, deps(ran, undefined, {}));
    expect(r.verified).toBe(true);
    expect(ran[0]).not.toContain("【技能·");
    expect(ran[0].startsWith("目标:")).toBe(true);
  });
});