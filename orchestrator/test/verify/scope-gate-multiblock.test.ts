import { describe, it, expect } from "vitest";
import { parseScopeDeclaration } from "../../src/verify/scope-gate.js";

describe("parseScopeDeclaration 聚合所有 scope 块", () => {
  it("多个 scope 块的 allow 全部合并(修 bug:原来只认第一个)", () => {
    const spec = [
      "# 段一",
      "```scope",
      "allow: a/one.ts",
      "```",
      "正文",
      "## 段二",
      "```scope",
      "allow: b/two.ts",
      "forbid: c/no.ts",
      "```",
    ].join("\n");
    const decl = parseScopeDeclaration(spec);
    expect(decl).toBeDefined();
    expect(decl!.allow).toContain("a/one.ts");
    expect(decl!.allow).toContain("b/two.ts");
    expect(decl!.forbid).toContain("c/no.ts");
  });
  it("单个 scope 块行为不变(向后兼容)", () => {
    const spec = ["```scope", "allow: x/only.ts", "```"].join("\n");
    const decl = parseScopeDeclaration(spec);
    expect(decl!.allow).toEqual(["x/only.ts"]);
  });
  it("没有 scope 块 → undefined", () => {
    expect(parseScopeDeclaration("# 无 scope")).toBeUndefined();
  });
});
