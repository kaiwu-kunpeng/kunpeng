import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("合并后重建 + 注意力项真测 dist 新鲜度（作者锁定）", () => {
  it("merge 命令在成功后调 postMergeBuild 并打印两种结果", () => {
    const src = read("../../src/cli-commands/devcycle.ts");
    const at = src.indexOf('name: "merge"');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 1500);
    expect(block).toContain("postMergeBuild(");
    expect(block).toContain("dist 已重建并冒烟通过");
    expect(block).toContain("dist 重建/冒烟失败");
  });

  it("/api/attention 用当前进程的 dist 对检出的 src 提交测新鲜度", () => {
    const src = read("../../src/server/routes/attention.ts");
    expect(src).toContain("measureDistFreshness(");
    expect(src).toContain("cliJsPath()");
    const at = src.indexOf("attentionItemsFromSnapshots(await attentionSnapshots(context)");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 200)).toMatch(/escalations,\s*\w*[dD]istFreshness/);
  });
});