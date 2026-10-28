import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoopDef } from "../../types.js";
import { runAgentPlaybookWave, type AgentPlaybookDeps } from "./runwave.js";

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

function deps(bodyText: string | undefined, ran: string[], execCode = 0): AgentPlaybookDeps {
  return {
    repoPath: mkdtempSync(join(tmpdir(), "kp-apb-")),
    runner: { async runStep(prompt: string) { ran.push(prompt); } },
    loadPlaybook: async () => (bodyText === undefined ? undefined : { body: bodyText }),
    execAssert: async () => execCode,
  };
}

describe("agent-playbook 执行器(前半)", () => {
  it("全步骤过断言 → verified,metric 不动", async () => {
    const ran: string[] = [];
    const r = await runAgentPlaybookWave(loopDef(), "card-a", undefined,
      deps(body([{ id: "s1", prompt: "做A", assert: "true" }, { id: "s2", prompt: "做B" }]), ran));
    expect(r.verified).toBe(true);
    expect(ran.length).toBe(2);
    expect(ran[0]).toContain("目标");
    expect(ran[0]).toContain("做A");
    expect(r.metricDelta).toBe(0);
    expect(r.metricAfter).toBe(7);
  });

  it("断言失败 → verified:false,gotcha 带 step id,后续步骤不跑", async () => {
    const ran: string[] = [];
    const r = await runAgentPlaybookWave(loopDef(), "card-a", undefined,
      deps(body([{ id: "s1", prompt: "做A", assert: "false" }, { id: "s2", prompt: "做B" }]), ran, 1));
    expect(r.verified).toBe(false);
    expect(ran.length).toBe(1);
    expect((r.gotchas ?? []).join(" ")).toContain("s1");
  });

  it("external 步骤 → 立即停,提示需动作级门", async () => {
    const ran: string[] = [];
    const r = await runAgentPlaybookWave(loopDef(), "card-a", undefined,
      deps(body([{ id: "s1", prompt: "对外发布", external: true }]), ran));
    expect(r.verified).toBe(false);
    expect(ran.length).toBe(0);
    const g = (r.gotchas ?? []).join(" ");
    expect(g).toContain("对外步骤");
    expect(g).toContain("动作级门");
  });

  it("playbook 不存在 / 无 aop → 结构化失败不裸抛", async () => {
    const r1 = await runAgentPlaybookWave(loopDef(), "card-a", undefined, deps(undefined, []));
    expect(r1.verified).toBe(false);
    expect((r1.gotchas ?? []).join(" ")).toContain("playbook 不存在");
    const r2 = await runAgentPlaybookWave(loopDef(), "card-a", undefined, deps("没有围栏", []));
    expect(r2.verified).toBe(false);
    expect((r2.gotchas ?? []).join(" ")).toContain("无 aop 步骤树");
  });
});
