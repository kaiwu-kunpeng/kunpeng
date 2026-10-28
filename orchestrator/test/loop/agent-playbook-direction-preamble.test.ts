import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import type { LoopDef } from "../../src/loop/types.js";
import {
  directionPreamble,
  runAgentPlaybookWave,
  type AgentPlaybookDeps,
} from "../../src/loop/recipes/agent-playbook/runwave.js";

const HEADER = "【本波方向 · 来自 loop.nextLever，优先于步骤内的自选】";

function loopDef(nextLever?: LoopDef["nextLever"]): LoopDef {
  return {
    id: "l1", name: "L1", projectId: "p1", recipe: "agent-playbook",
    metric: { key: "m", label: "M", current: 7 },
    levers: [{ id: "card-a", label: "卡A", status: "active" }],
    waves: [], createdAt: 1, updatedAt: 1,
    ...(nextLever === undefined ? {} : { nextLever }),
  };
}

function body(steps: unknown[]): string {
  return ["```aop", JSON.stringify({ goal: "目标", steps }), "```"].join("\n");
}

function deps(bodyText: string, ran: string[]): AgentPlaybookDeps {
  return {
    repoPath: mkdtempSync(join(tmpdir(), "kp-dir-")),
    runner: { async runStep(prompt: string) { ran.push(prompt); } },
    loadPlaybook: async () => ({ body: bodyText }),
    execAssert: async () => 0,
  };
}

describe("directionPreamble", () => {
  it("没有 note 也没有 target → 空串", () => {
    expect(directionPreamble(loopDef(), undefined)).toBe("");
    expect(directionPreamble(loopDef({ lever: "x", note: "  " }), "")).toBe("");
  });

  it("只有 note → 标题行 + 方向行", () => {
    expect(directionPreamble(loopDef({ lever: "x", note: "做成都" }), undefined)).toBe(
      `${HEADER}\n方向: 做成都`,
    );
  });

  it("note 与 target 都有 → 标题行 + 目标对象行 + 方向行", () => {
    expect(
      directionPreamble(loopDef({ lever: "x", target: "RADIATOR", note: "先查库存" }), "RADIATOR"),
    ).toBe(`${HEADER}\n目标对象: RADIATOR\n方向: 先查库存`);
  });
});

describe("每一步的提示词都带方向块", () => {
  const steps = [{ id: "s1", prompt: "做A", assert: "true" }, { id: "s2", prompt: "做B" }];

  it("有 note 时两步都收到方向，且在「目标:」之前", async () => {
    const ran: string[] = [];
    const r = await runAgentPlaybookWave(
      loopDef({ lever: "card-a", note: "本波做深圳" }),
      "card-a",
      undefined,
      deps(body(steps), ran),
    );
    expect(r.verified).toBe(true);
    expect(ran.length).toBe(2);
    for (const prompt of ran) {
      expect(prompt).toContain("方向: 本波做深圳");
      expect(prompt).toContain(HEADER);
      expect(prompt.indexOf(HEADER)).toBeLessThan(prompt.indexOf("目标: "));
    }
  });

  it("没有 note 时提示词不含方向块（与现状一致）", async () => {
    const ran: string[] = [];
    await runAgentPlaybookWave(loopDef(), "card-a", undefined, deps(body(steps), ran));
    expect(ran.length).toBe(2);
    for (const prompt of ran) {
      expect(prompt).not.toContain("本波方向");
      expect(prompt).toContain("目标: ");
    }
  });
});