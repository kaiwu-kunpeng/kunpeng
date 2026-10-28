import { describe, it, expect } from "vitest";
import { extractFocusSymbols, buildRepoMapContext } from "../../src/context/spec-context.js";

describe("extractFocusSymbols", () => {
  it("反引号内标识符无条件收", () => {
    const r = extractFocusSymbols("修复 `localFsConvFrame` 的导出");
    expect(r).toContain("localFsConvFrame");
  });
  it("裸标识符要含大写或下划线(排除普通短词)", () => {
    const r = extractFocusSymbols("给 PtySessionPool 加 max_sessions 上限，就 add a button");
    expect(r).toContain("PtySessionPool");
    expect(r).toContain("max_sessions");
    expect(r).not.toContain("button");
    expect(r).not.toContain("add");
  });
  it("去重保序，反引号优先", () => {
    const r = extractFocusSymbols("`Foo` 用到 Foo 和 barBaz");
    expect(r).toEqual(["Foo", "barBaz"]);
  });
});

describe("buildRepoMapContext", () => {
  const files = [
    { path: "core.ts", source: "export function target() {}\nexport const helper = 1;" },
    { path: "other.ts", source: "export const o = 1;" },
  ];
  it("空 files 返回空串", () => {
    expect(buildRepoMapContext([], "随便")).toBe("");
  });
  it("带标题 + 焦点文件在前", () => {
    const ctx = buildRepoMapContext(files, "改 `target` 的逻辑");
    expect(ctx).toContain("## 现有代码地图（相关优先）");
    expect(ctx).toContain("core.ts");
    expect(ctx.indexOf("core.ts")).toBeLessThan(ctx.indexOf("other.ts"));
  });
});
