import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { persistProposal } from "../../src/loop/self-evolution.js";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-skill-prop-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("蒸馏技能走提案（作者锁定）", () => {
  it("persistProposal 把 skills 变更列在「拟固化技能」节，不混进 conventions 节", async () => {
    const store = new ArtifactStore(join(dir, "artifacts"));
    await persistProposal(store, "skill-geo-answer-abc", {
      sourceExperiences: ["exp-1", "exp-2"],
      changes: [
        { target: "skills", text: "geo-answer", source: "distill-skill" },
        { target: "conventions", text: "先红后绿", source: "exp-1" },
      ],
      rejected: [],
    });
    const a = await store.read("skill-geo-answer-abc");
    expect(a.kind).toBe("proposal");
    expect(a.status).toBe("draft");
    expect(a.body).toContain("## 拟固化技能");
    expect(a.body).toContain("人工门 #2");
    expect(a.body).toContain("- [skills] geo-answer（源 distill-skill）");
    const conv = a.body.slice(a.body.indexOf("## 拟改（conventions）"), a.body.indexOf("## 拟固化技能"));
    expect(conv).toContain("先红后绿");
    expect(conv).not.toContain("geo-answer");
    expect((a.meta as { proposal?: { changes?: unknown[] } }).proposal?.changes).toHaveLength(2);
  });

  it("接线：distill-skill 落提案，apply-live 注入 backlogSkillsApplier，apply 认 applySkills，蒸馏结果带 experienceIds", () => {
    const lib = read("../../src/cli-commands/library-skills.ts");
    expect(lib).toContain("persistProposal(");
    expect(lib).toContain('target: "skills"');
    expect(lib).toContain("人工门 #2");
    const live = read("../../src/evolution/apply-live.ts");
    expect(live).toContain("backlogSkillsApplier(");
    expect(live).toContain("applySkills");
    expect(live).toContain("validateSkillMd");
    expect(read("../../src/evolution/apply.ts")).toContain("applySkills");
    expect(read("../../src/knowledge/distill-skill.ts")).toContain("experienceIds");
  });
});