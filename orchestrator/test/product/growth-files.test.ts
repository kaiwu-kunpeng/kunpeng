import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { factsFromDefinition, renderLlmsTxt, renderSeoJson, writeGrowthFiles } from "../../src/product/growth-files.js";

const def = {
  idea: "本机便签墙，一个页面记录团队便签",
  problem: "团队便签散落",
  users: ["团队成员", "管理员"],
  stories: ["作为成员，我可以新增便签，以便记录待办。", "作为管理员，我可以删除过期便签。"],
};

describe("growth-files 生成", () => {
  it("factsFromDefinition 抽取实体事实", () => {
    const facts = factsFromDefinition(def, "notes-wall");
    expect(facts.name).toBe("notes-wall");
    expect(facts.tagline).toContain("便签墙");
    expect(facts.audience).toEqual(["团队成员", "管理员"]);
    expect(facts.useCases.length).toBe(2);
  });

  it("llms.txt 与 seo.json 内容成型", () => {
    const facts = factsFromDefinition(def, "notes-wall");
    const llms = renderLlmsTxt(facts);
    expect(llms).toContain("# notes-wall");
    expect(llms).toContain("适合谁");
    expect(llms).toContain("核心用例");
    expect(llms).toContain("llms.txt");
    const seo = JSON.parse(renderSeoJson(facts)) as Record<string, unknown>;
    expect(seo.name).toBe("notes-wall");
    expect(Array.isArray(seo.useCases)).toBe(true);
  });

  it("writeGrowthFiles 落工作区且不覆盖已有", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-gf-"));
    try {
      const written = await writeGrowthFiles(root, "demo", def);
      expect(written.sort()).toEqual(["llms.txt", "seo.json"]);
      const ws = join(root, "products", "demo");
      expect(existsSync(join(ws, "llms.txt"))).toBe(true);
      writeFileSync(join(ws, "llms.txt"), "人工定制版");
      const second = await writeGrowthFiles(root, "demo", def);
      expect(second).toEqual([]);
      expect(readFileSync(join(ws, "llms.txt"), "utf8")).toBe("人工定制版");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
