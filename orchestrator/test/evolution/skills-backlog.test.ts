import { describe, expect, it, vi } from "vitest";
import { applyApprovedProposals } from "../../src/evolution/apply.js";
import { route } from "../../src/evolution/route.js";
import {
  SKILLS_BACKLOG_PREFIX,
  SKILLS_BACKLOG_SOURCE,
  SKILL_SLUG_RE,
  backlogSkillsApplier,
  skillsBacklogTask,
} from "../../src/evolution/skills-backlog.js";
import type { AgentRunner } from "../../src/agent/runner.js";

const DRAFT = "---\nname: geo-answer\ndescription: 答案页可引用性\n---\n\n# 答案页可引用性\n\n先给结论再给依据。\n";

describe("技能固化入 backlog（作者锁定）", () => {
  it("任务：前缀/来源/只改一个文件/scope/验收命令/原文缩进；指纹随内容变化", () => {
    const t = skillsBacklogTask("geo-answer", DRAFT);
    expect(t.source).toBe(SKILLS_BACKLOG_SOURCE);
    expect(t.severity).toBe("error");
    expect(t.requirement.startsWith(`${SKILLS_BACKLOG_PREFIX} `)).toBe(true);
    expect(t.requirement).toContain("skills/geo-answer/SKILL.md");
    expect(t.requirement).toContain("allow: skills/geo-answer/SKILL.md");
    expect(t.requirement).toContain("forbid: constitution/**");
    expect(t.requirement).toContain("forbid: orchestrator/**");
    expect(t.requirement).toContain("grep -qF -- 'name: geo-answer' skills/geo-answer/SKILL.md");
    expect(t.requirement).toContain("! grep -qE '^(model|sandbox|mcp|mcp-servers|mcpServers):' skills/geo-answer/SKILL.md");
    expect(t.requirement).toContain("    name: geo-answer");
    expect(t.requirement).toContain("    先给结论再给依据。");
    expect(skillsBacklogTask("geo-answer", DRAFT + "x").fingerprint).not.toBe(t.fingerprint);
    expect(skillsBacklogTask("geo-answer", DRAFT).fingerprint).toBe(t.fingerprint);
    expect(SKILL_SLUG_RE.test("geo-answer")).toBe(true);
    expect(SKILL_SLUG_RE.test("Bad_Slug")).toBe(false);
  });

  it("applier：合法草稿入队；坏 slug/草稿缺失/验真失败拒绝；与仓库已同内容则跳过", async () => {
    const enqueue = vi.fn(async () => ({ added: ["x"], skipped: [] }));
    const seen: string[] = [];
    const apply = backlogSkillsApplier({
      readDraft: async (slug) => (slug === "missing" ? null : slug === "bad-head" ? "---\nname: bad-head\nmodel: gpt\n---\n# x\n" : DRAFT),
      readRepoSkill: async (slug) => (slug === "already" ? DRAFT : null),
      validate: (md) => (md.includes("model:") ? { ok: false, errors: ["frontmatter 含 model（受保护路径）"] } : { ok: true, errors: [] }),
      enqueue,
      onEnqueued: (task) => { seen.push(task.requirement.slice(0, 60)); },
    });
    const r = await apply([
      { target: "skills", text: "geo-answer", source: "distill-skill" },
      { target: "skills", text: "Bad_Slug", source: "distill-skill" },
      { target: "skills", text: "missing", source: "distill-skill" },
      { target: "skills", text: "bad-head", source: "distill-skill" },
      { target: "skills", text: "already", source: "distill-skill" },
    ]);
    expect(r.enqueued).toEqual(["geo-answer"]);
    expect(r.skipped).toEqual(["already"]);
    expect(r.rejected.map((x) => x.slug)).toEqual(["Bad_Slug", "missing", "bad-head"]);
    expect(r.rejected[0]!.reason).toContain("slug");
    expect(r.rejected[1]!.reason).toContain("草稿不存在");
    expect(r.rejected[2]!.reason).toContain("受保护路径");
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(seen[0]).toContain("geo-answer");
  });

  it("applyApprovedProposals：有 applySkills 时入队计数并 verified；没有时进 unrouted、状态不动", async () => {
    const base = {
      conventionsPath: "/tmp/x/conventions.md",
      route,
      applyConventions: async () => ({ appended: [], skipped: [] }),
      draftPlanFromUpgrades: async () => "",
      auditGeneratedPlan: () => ({ safe: true, violations: [] }),
      draftRunner: { run: async () => ({ text: "", meta: {} }) } as unknown as AgentRunner,
      planRunner: async () => {},
    };
    const proposal = { id: "skill-geo-answer-1", status: "approved", changes: [{ target: "skills", text: "geo-answer", source: "distill-skill" }] };
    const withDep = await applyApprovedProposals([proposal], { ...base, applySkills: async () => ({ enqueued: ["geo-answer"], skipped: [], rejected: [] }) });
    expect(withDep.outcomes[0]!.skillsEnqueued).toBe(1);
    expect(withDep.outcomes[0]!.status).toBe("verified");
    expect(withDep.skillsEnqueued).toBe(1);
    const without = await applyApprovedProposals([proposal], base);
    expect(without.outcomes[0]!.skillsEnqueued).toBe(0);
    expect(without.outcomes[0]!.unrouted.map((c) => c.text)).toEqual(["geo-answer"]);
    expect(without.outcomes[0]!.status).toBe("approved");
  });
});