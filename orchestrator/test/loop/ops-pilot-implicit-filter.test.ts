import { describe, it, expect } from "vitest";
import { selectImplicitSkillCandidates } from "../../src/loop/ops-pilot.js";
import type { SkillEntry } from "../../src/skills/registry.js";

function skill(id: string, implicitInvocation?: boolean, activations?: number): SkillEntry {
  return {
    id,
    name: id,
    description: id,
    origin: "authored",
    dir: `/tmp/${id}`,
    registeredAt: "2026-01-01T00:00:00.000Z",
    ...(implicitInvocation === undefined ? {} : { implicitInvocation }),
    ...(activations === undefined ? {} : { usage: { activations } }),
  } as unknown as SkillEntry;
}

describe("selectImplicitSkillCandidates", () => {
  it("禁止隐式调用的技能被过滤掉", () => {
    const out = selectImplicitSkillCandidates([
      skill("keep-default"),
      skill("blocked", false),
      skill("keep-true", true),
    ]);
    expect(out.map((s) => s.id)).toEqual(["keep-default", "keep-true"]);
  });

  it("不超过 30 个时保持原顺序", () => {
    const out = selectImplicitSkillCandidates([skill("c"), skill("a"), skill("b")]);
    expect(out.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("超过 30 个时按 activations 降序取前 30", () => {
    const many = Array.from({ length: 35 }, (_, i) => skill(`s${i}`, undefined, i));
    const out = selectImplicitSkillCandidates(many);
    expect(out.length).toBe(30);
    expect(out[0]?.id).toBe("s34");
    expect(out[29]?.id).toBe("s5");
  });

  it("过滤发生在取前 30 之前", () => {
    const many = Array.from({ length: 35 }, (_, i) => skill(`s${i}`, i === 34 ? false : undefined, i));
    const out = selectImplicitSkillCandidates(many);
    expect(out.map((s) => s.id)).not.toContain("s34");
  });

  it("不改写入参数组", () => {
    const input = [skill("a"), skill("blocked", false)];
    const snapshot = input.map((s) => s.id);
    selectImplicitSkillCandidates(input);
    expect(input.map((s) => s.id)).toEqual(snapshot);
  });
});