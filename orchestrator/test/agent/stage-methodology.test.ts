import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FALLBACK_METHODOLOGY,
  applyHostSections,
  loadStageMethodology,
  stageMethodologyRoot,
} from "../../src/agent/stage-methodology.js";
import { EVALUATOR_SYSTEM } from "../../src/verify/evaluator.js";
import { validateSkillMd } from "../../src/skills/skill-md.js";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "kp-methodology-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe("阶段方法论文件（作者锁定）", () => {
  it("仓根三份文件存在、能过 skill 校验、去掉 frontmatter 后按阶段命中关键字", () => {
    const root = stageMethodologyRoot();
    for (const stage of ["plan", "implement", "verify"] as const) {
      const md = readFileSync(join(root, "skills", stage, "SKILL.md"), "utf8");
      expect(validateSkillMd(md).ok, `${stage} 校验`).toBe(true);
      const text = loadStageMethodology(stage, "claude");
      expect(text.startsWith("---")).toBe(false);
      expect(text).not.toContain("name: " + stage);
      expect(text.length).toBeGreaterThan(40);
    }
    expect(loadStageMethodology("plan", "claude")).toContain("TESTCMD");
    expect(loadStageMethodology("implement", "claude")).not.toContain("TESTCMD");
    expect(loadStageMethodology("implement", "claude")).toContain("不要自行定义任何验证命令");
    expect(loadStageMethodology("verify", "claude")).toContain("pass|fail|inconclusive");
    expect(loadStageMethodology("verify", "claude")).toContain("只读评估器");
  });

  it("宿主分段：只保留匹配宿主的块，块外文本全保留", () => {
    const body = "通用\n\n<!-- host:codex -->\n只给 codex\n<!-- /host -->\n\n<!-- host:claude -->\n只给 claude\n<!-- /host -->\n\n收尾";
    const claude = applyHostSections(body, "claude");
    const codex = applyHostSections(body, "codex");
    expect(claude).toContain("通用");
    expect(claude).toContain("只给 claude");
    expect(claude).not.toContain("只给 codex");
    expect(codex).toContain("只给 codex");
    expect(codex).not.toContain("只给 claude");
    expect(codex).toContain("收尾");
    expect(claude).not.toMatch(/\n{3,}/);
    expect(loadStageMethodology("implement", "codex")).toContain("workspace-write 沙箱");
    expect(loadStageMethodology("implement", "claude")).not.toContain("workspace-write 沙箱");
  });

  it("文件缺失或去掉 frontmatter 后为空 → 回退到内置文案；verify 的内置文案就是 EVALUATOR_SYSTEM", () => {
    expect(loadStageMethodology("plan", "claude", { root: join(tmp, "nope") })).toBe(FALLBACK_METHODOLOGY.plan);
    mkdirSync(join(tmp, "skills", "implement"), { recursive: true });
    writeFileSync(join(tmp, "skills", "implement", "SKILL.md"), "---\nname: implement\ndescription: x\n---\n\n", "utf8");
    expect(loadStageMethodology("implement", "codex", { root: tmp })).toBe(FALLBACK_METHODOLOGY.implement);
    expect(FALLBACK_METHODOLOGY.verify).toBe(EVALUATOR_SYSTEM);
    expect(FALLBACK_METHODOLOGY.plan).toContain("TESTCMD");
  });

  it("frontmatter 拒绝 model/sandbox/mcp 配置键；requires-mcp 依赖声明照常；仓根全部技能仍合格", () => {
    const ok = "---\nname: demo-skill\ndescription: d\nrequires-mcp: [xcrawl]\n---\n\n# 演示\n";
    expect(validateSkillMd(ok).ok).toBe(true);
    for (const key of ["model", "sandbox", "mcp", "mcp-servers", "mcpServers"]) {
      const bad = `---\nname: demo-skill\ndescription: d\n${key}: something\n---\n\n# 演示\n`;
      const v = validateSkillMd(bad);
      expect(v.ok, key).toBe(false);
      expect(v.errors.join("\n")).toContain(key);
      expect(v.errors.join("\n")).toContain("受保护路径");
    }
    const skillsDir = join(stageMethodologyRoot(), "skills");
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const md = readFileSync(join(skillsDir, entry.name, "SKILL.md"), "utf8");
      expect(validateSkillMd(md).ok, entry.name).toBe(true);
    }
  });
});