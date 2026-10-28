import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { pilotNext, recipeAcceptsSkills } from "../../src/loop/ops-pilot.js";
import { recipeRegistry } from "../../src/loop/recipe.js";
import "../../src/loop/geo-monitor.js";
import "../../src/loop/site-capture.js";
import "../../src/loop/wechat-capture.js";
import "../../src/loop/seo-internal-links.js";
import "../../src/loop/agent-playbook.js";
import type { LoopDef } from "../../src/loop/types.js";

// 背景（2026-10-03 运营审计 A3 G4，总报告 P1-8）：领航给每个 loop 都推技能候选并让 LLM 选，但 geo-monitor 等 4/5 个 recipe
// 的 runWave 根本不消费 nextLever.skills（geo 甚至把它记成 ignoredSkills）——白烧一次选型，还把"激活"记进技能战绩。
// 本测试锁定：recipe 声明 acceptsSkills；不吃技能的 recipe 领航拿不到候选、plan.skills 必为空；吃技能的照旧。

function mk(prefix: string): string { return mkdtempSync(join(tmpdir(), prefix)); }
function loopDef(recipe: string): LoopDef {
  return { id: "demo-loop", name: "Demo", projectId: "demo", recipe, autonomous: true,
    metric: { key: "m", label: "M", current: 1 }, levers: [{ id: "go", label: "走", status: "active" }],
    nextLever: { lever: "go" }, waves: [], createdAt: 1, updatedAt: 1 };
}
function skillsRootWith(ids: string[]): string {
  const root = mk("kp-pilot-skills-");
  writeFileSync(join(root, "index.json"), JSON.stringify(ids.map((id) => ({ id, name: id, description: `${id} 描述`, dir: join(root, id), registeredAt: "2026-01-01T00:00:00.000Z" }))));
  return root;
}

describe("领航只给吃技能的 recipe 推候选（作者锁定）", () => {
  it("五个 recipe 的声明：agent-playbook 吃技能，其余四个不吃；未注册 recipe 当吃；注入覆盖优先", () => {
    expect(recipeRegistry["agent-playbook"]?.acceptsSkills).toBe(true);
    for (const id of ["geo-monitor", "site-capture", "wechat-capture", "seo-internal-links"]) expect(recipeRegistry[id]?.acceptsSkills, id).toBe(false);
    expect(recipeAcceptsSkills("agent-playbook")).toBe(true);
    expect(recipeAcceptsSkills("geo-monitor")).toBe(false);
    expect(recipeAcceptsSkills("some-unregistered-recipe")).toBe(true);
    expect(recipeAcceptsSkills("agent-playbook", false)).toBe(false);
  });

  it("geo-monitor loop：prompt 候选为「(无)」，模型硬塞的 skills 被丢弃，nextLever 不带 skills", async () => {
    const skillsRoot = skillsRootWith(["geo-answer-optimization"]);
    const prompts: string[] = [];
    const runner = { run: async (req: { input: string }) => { prompts.push(req.input); return { text: '{"lever":"go","skills":["geo-answer-optimization"],"waveGoal":"g","stopLoss":"s","reason":"r"}' }; } };
    const setNext = vi.fn(async () => undefined);
    const r = await pilotNext("demo-loop", { runner, store: { read: async () => loopDef("geo-monitor"), setNext } as never, skillsRoot, stateDir: mk("kp-pilot-state-") });
    expect(r.plan.skills).toEqual([]);
    expect(prompts[0]).toContain("- (无)");
    expect(prompts[0]).not.toContain("geo-answer-optimization");
    expect(setNext).toHaveBeenCalledWith("demo-loop", { lever: "go", note: "g | skills: | stopLoss:s" });
  });

  it("agent-playbook loop：同一套技能库照旧进候选并可被选中", async () => {
    const skillsRoot = skillsRootWith(["geo-answer-optimization"]);
    const prompts: string[] = [];
    const runner = { run: async (req: { input: string }) => { prompts.push(req.input); return { text: '{"lever":"go","skills":["geo-answer-optimization"],"waveGoal":"g","stopLoss":"s","reason":"r"}' }; } };
    const setNext = vi.fn(async () => undefined);
    const r = await pilotNext("demo-loop", { runner, store: { read: async () => loopDef("agent-playbook"), setNext } as never, skillsRoot, stateDir: mk("kp-pilot-state2-") });
    expect(prompts[0]).toContain("geo-answer-optimization");
    expect(r.plan.skills).toEqual(["geo-answer-optimization"]);
    expect(setNext).toHaveBeenCalledWith("demo-loop", expect.objectContaining({ skills: ["geo-answer-optimization"] }));
  });
});