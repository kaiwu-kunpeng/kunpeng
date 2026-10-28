import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import "../../src/cli.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { renderCliIndex, syncCliIndex } from "../../src/help/cli-reference.js";

const DOC_REL = "docs/help/02-user-guide/cli-reference.md";
const doc = readFileSync(new URL(`../../../${DOC_REL}`, import.meta.url), "utf8");
const names = listCliCommands().map((c) => c.name);

function sections(md: string): Array<{ name: string; body: string }> {
  return md.split(/^### `/m).slice(1).map((chunk) => ({
    name: chunk.slice(0, chunk.indexOf("`")),
    body: chunk.split(/^## /m)[0],
  }));
}

describe("renderCliIndex / syncCliIndex（作者锁定）", () => {
  test("索引块格式固定：排序、去重、带计数", () => {
    expect(renderCliIndex(["run", "board", "run", "acp"])).toBe(
      "<!-- cli-index:start -->\n共 3 个命令：`acp` · `board` · `run`\n<!-- cli-index:end -->",
    );
  });

  test("syncCliIndex 只替换标记之间的内容，其余原样保留", () => {
    const before = "# 标题\n\n<!-- cli-index:start -->\n旧内容\n<!-- cli-index:end -->\n\n## 正文\n";
    expect(syncCliIndex(before, ["b", "a"])).toBe(
      "# 标题\n\n<!-- cli-index:start -->\n共 2 个命令：`a` · `b`\n<!-- cli-index:end -->\n\n## 正文\n",
    );
  });

  test("文档里没有索引标记时抛错，不静默追加", () => {
    expect(() => syncCliIndex("# 无标记\n", ["a"])).toThrow(/cli-index/);
  });
});

describe("CLI 参考与命令注册表一致（作者锁定）", () => {
  test("文档里的索引块与注册表逐字一致", () => {
    const start = doc.indexOf("<!-- cli-index:start -->");
    const end = doc.indexOf("<!-- cli-index:end -->");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(doc.slice(start, end + "<!-- cli-index:end -->".length)).toBe(renderCliIndex(names));
  });

  test("每个注册命令都有且只有一个 ### 章节，文档里没有已不存在的命令", () => {
    const heads = sections(doc).map((s) => s.name);
    expect([...heads].sort()).toEqual([...new Set(names)].sort());
    expect(new Set(heads).size).toBe(heads.length);
  });

  test("每个章节都有实写的用途与带命令名的示例，用途各不相同", () => {
    const purposes: string[] = [];
    for (const { name, body } of sections(doc)) {
      expect(body, name).toMatch(/^- 用途：.{6,}/m);
      expect(body, name).toMatch(new RegExp(`^- 示例：.*kunpeng ${name.replace(/[-]/g, "\\-")}\\b`, "m"));
      purposes.push((/^- 用途：(.*)$/m.exec(body) ?? ["", ""])[1].trim());
    }
    expect(new Set(purposes).size).toBe(purposes.length);
  });

  test("过时的「70 个公开命令」说法已删除", () => {
    expect(doc).not.toContain("全部 70 个公开命令");
    expect(doc).toContain("## 通用调用方式");
  });
});

describe("kunpeng doc cli-reference 由注册表重写索引块（作者锁定）", () => {
  test("在临时仓库里把陈旧索引块改写成注册表当前内容", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-cliref-"));
    try {
      mkdirSync(join(repo, "docs/help/02-user-guide"), { recursive: true });
      const path = join(repo, DOC_REL);
      writeFileSync(path, "# 参考\n\n<!-- cli-index:start -->\n共 1 个命令：`old`\n<!-- cli-index:end -->\n\n## 通用调用方式\n");
      const doc = listCliCommands().find((c) => c.name === "doc");
      expect(doc).toBeDefined();
      await doc!.run({ repoRoot: repo, kunpengHome: repo, rest: ["cli-reference"], argv: ["doc", "cli-reference"], flags: new Set() });
      const out = readFileSync(path, "utf8");
      expect(out).toBe(`# 参考\n\n${renderCliIndex(names)}\n\n## 通用调用方式\n`);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});