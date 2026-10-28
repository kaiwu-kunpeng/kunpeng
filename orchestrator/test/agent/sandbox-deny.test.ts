import { describe, it, expect } from "vitest";
import { buildSandboxProfile, governanceDenyPaths } from "../../src/agent/sandbox-wrap.js";

describe("buildSandboxProfile 的 deny 参数", () => {
  it("不传 deny 时输出与今天逐字节一致", () => {
    const a = buildSandboxProfile(["/a/b"]);
    const b = buildSandboxProfile(["/a/b"], {});
    expect(b).toBe(a);
    expect(a).not.toContain("(deny file-write*\n");
  });

  it("空数组等同于不传", () => {
    const a = buildSandboxProfile(["/a/b"]);
    const b = buildSandboxProfile(["/a/b"], { subpaths: [], literals: [] });
    expect(b).toBe(a);
  });

  it("传入 subpath 与 literal 后都出现在 deny 规则里", () => {
    const p = buildSandboxProfile(["/wt"], {
      subpaths: ["/wt/constitution"],
      literals: ["/wt/AGENTS.md"],
    });
    expect(p).toContain("(deny file-write*\n");
    expect(p).toContain('(subpath "/wt/constitution")');
    expect(p).toContain('(literal "/wt/AGENTS.md")');
  });

  it("deny 规则必须排在 allow 规则之后（seatbelt 后匹配者胜）", () => {
    const p = buildSandboxProfile(["/wt"], { subpaths: ["/wt/constitution"] });
    const allowAt = p.indexOf('(allow file-write*');
    const denyAt = p.indexOf("(deny file-write*\n");
    expect(allowAt).toBeGreaterThan(-1);
    expect(denyAt).toBeGreaterThan(allowAt);
  });

  it("deny 路径里的引号被转义", () => {
    const p = buildSandboxProfile(["/wt"], { literals: ['/wt/"; (allow file-write*) ;"'] });
    expect(p).not.toContain('(literal "/wt/"; (allow file-write*) ;"")');
    expect(p).toContain("\\\"");
  });

  it("允许只传 subpaths 或只传 literals", () => {
    const onlySub = buildSandboxProfile(["/wt"], { subpaths: ["/wt/c"] });
    expect(onlySub).toContain('(subpath "/wt/c")');
    const onlyLit = buildSandboxProfile(["/wt"], { literals: ["/wt/f.md"] });
    expect(onlyLit).toContain('(literal "/wt/f.md")');
  });
});

describe("governanceDenyPaths", () => {
  it("返回宪法目录与两份治理文档", () => {
    const d = governanceDenyPaths("/repo/wt/x");
    expect(d.subpaths).toEqual(["/repo/wt/x/constitution"]);
    expect(d.literals).toEqual(["/repo/wt/x/AGENTS.md", "/repo/wt/x/SPEC-TEMPLATE.md"]);
  });

  it("结果可直接喂给 buildSandboxProfile", () => {
    const p = buildSandboxProfile(["/repo/wt/x"], governanceDenyPaths("/repo/wt/x"));
    expect(p).toContain('(subpath "/repo/wt/x/constitution")');
    expect(p).toContain('(literal "/repo/wt/x/AGENTS.md")');
    expect(p).toContain('(literal "/repo/wt/x/SPEC-TEMPLATE.md")');
  });
});