import { describe, expect, it } from "vitest";
import { detectScopeDrift, parseScopeDeclaration, unquoteGitPath } from "./scope-gate.js";

describe("unquoteGitPath", () => {
  it("解码带引号的八进制转义(UTF-8 中文)", () => {
    const quoted = '"docs/decisions/0015-\\346\\212\\200\\350\\203\\275.md"';
    expect(unquoteGitPath(quoted)).toBe("docs/decisions/0015-技能.md");
  });

  it("不带引号原样返回;普通 ASCII 不受影响", () => {
    expect(unquoteGitPath("src/a.ts")).toBe("src/a.ts");
    expect(unquoteGitPath('"src/with\\"quote.ts"')).toBe('src/with"quote.ts');
  });
});

describe("detectScopeDrift 对转义路径", () => {
  it("中文 allow glob 命中被转义的变更路径,不再误杀", () => {
    const scope = parseScopeDeclaration(["```scope", "allow: docs/decisions/0015-技能能.md", "allow: src/**", "```"].join("\n"));
    expect(scope).toBeTruthy();
    const quoted = '"docs/decisions/0015-\\346\\212\\200\\350\\203\\275\\350\\203\\275.md"';
    const r = detectScopeDrift([quoted, "src/x.ts"], scope!);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("解码后仍在 allow 之外的照常报 violation,file 为解码后路径", () => {
    const scope = parseScopeDeclaration(["```scope", "allow: src/**", "```"].join("\n"));
    const quoted = '"docs/\\346\\212\\200.md"';
    const r = detectScopeDrift([quoted], scope!);
    expect(r.ok).toBe(false);
    expect(r.violations[0].file).toBe("docs/技.md");
  });
});