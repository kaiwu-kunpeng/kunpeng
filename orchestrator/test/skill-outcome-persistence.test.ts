import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { persistSkillOutcomes } from "../src/loop/wave-report.js";
import {
  listSkills,
  recordSkillActivation,
  recordSkillOutcome,
  registerSkill,
} from "../src/skills/registry.js";

function addSkill(root: string, id: string): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${id}\n---\n`, "utf8");
  registerSkill(root, {
    id,
    name: id,
    description: id,
    origin: "authored",
    dir,
  });
}

function action(loopId: string, at: number, metricDelta: number, verified: boolean) {
  return {
    at,
    loopId,
    projectId: "project",
    recipe: "test",
    lever: "test",
    subject: "test",
    metricKey: "metric",
    metricAfter: metricDelta,
    metricDelta,
    verified,
  };
}

describe("技能战绩持久化", () => {
  it("保留旧 usage 并累计胜负、时间戳和退役状态", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-outcome-"));
    addSkill(root, "skill-a");
    recordSkillActivation(root, ["skill-a"], "2026-07-12T00:00:00Z");

    await recordSkillOutcome(root, "skill-a", "win", 10);
    for (const at of [11, 12, 13, 14, 15]) {
      await recordSkillOutcome(root, "skill-a", "loss", at);
    }

    const [persisted] = listSkills(root);
    expect(persisted.usage).toMatchObject({
      activations: 1,
      lastHitAt: "2026-07-12T00:00:00Z",
      wins: 1,
      losses: 5,
      lastOutcomeAt: 15,
    });
    expect(persisted.lifecycle).toBe("deprecated");
    expect(JSON.parse(readFileSync(join(root, "index.json"), "utf8"))).toHaveLength(1);

    const again = await recordSkillOutcome(root, "skill-a", "win", 16);
    expect(again.newlyDeprecated).toBe(false);
    expect(listSkills(root)).toHaveLength(1);
    expect(listSkills(root)[0].lifecycle).toBe("deprecated");
    await expect(recordSkillOutcome(root, "ghost", "loss", 17)).rejects.toThrow("未找到技能");
  });

  it("按真实 wave/action 回灌且通过落盘判重跨调用幂等", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-wave-outcome-"));
    addSkill(root, "winner");
    addSkill(root, "loser");
    const plans = [
      { at: 10, loopId: "win-loop", plan: { skills: ["winner", "winner", "ghost"] } },
      { at: 20, loopId: "loss-loop", plan: { skills: ["loser"] } },
      { at: 30, loopId: "no-action", plan: { skills: ["winner"] } },
    ];
    const actions = [
      action("win-loop", 11, 1, true),
      action("loss-loop", 21, 2, false),
    ];

    const first = await persistSkillOutcomes(root, plans, actions);
    const second = await persistSkillOutcomes({ root, waveplans: plans, actions });

    expect(first).toMatchObject({ processedWaves: 2, recordedOutcomes: 2 });
    expect(second).toMatchObject({ processedWaves: 0, recordedOutcomes: 0 });
    const skills = listSkills(root);
    expect(skills.find((skill) => skill.id === "winner")?.usage).toMatchObject({ wins: 1, losses: 0 });
    expect(skills.find((skill) => skill.id === "loser")?.usage).toMatchObject({ wins: 0, losses: 1 });
    expect(skills.some((skill) => skill.id === "ghost")).toBe(false);
    expect(JSON.parse(readFileSync(join(root, "outcome-waves.json"), "utf8")).processed).toHaveLength(2);
  });
});
