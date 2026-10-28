import { describe, it, expect } from "vitest";
import { queryRelevant, renderSkeleton } from "../../src/context/repo-map.js";

const files = [
  { path: "core.ts", source: "export function target() {}\nexport const helper = 1;" },
  { path: "caller.ts", source: "import { target } from './core';\nexport const c = 1;" },
  { path: "unrelated.ts", source: "export const u = 1;" },
];

describe("queryRelevant", () => {
  it("导出目标符号=强相关(2)，调用者=次相关(1)，无关=0", () => {
    const r = queryRelevant(files, ["target"]);
    expect(r[0].path).toBe("core.ts");
    expect(r[0].relevance).toBe(2);
    expect(r[1].path).toBe("caller.ts");
    expect(r[1].relevance).toBe(1);
    expect(r[2].path).toBe("unrelated.ts");
    expect(r[2].relevance).toBe(0);
    expect(r[0].refs).toBe(1); // core 被 caller 引用
  });
  it("目标不命中时全 0、退化为 refs/path 排序", () => {
    const r = queryRelevant(files, ["nope"]);
    expect(r.every((x) => x.relevance === 0)).toBe(true);
    expect(r[0].path).toBe("core.ts"); // refs=1 最高
  });
});

describe("renderSkeleton", () => {
  const many = [
    { path: "hub.ts", source: "export const a=1;\nexport const b=2;\nexport const c=3;" },
    { path: "f2.ts", source: "import './hub';\nexport const x=1;" },
    { path: "f3.ts", source: "import './hub';" },
  ];
  it("含路径与导出符号行，hub(refs 高)在前", () => {
    const s = renderSkeleton(many, { maxChars: 5000 });
    expect(s).toContain("hub.ts");
    expect(s).toContain("· a");
    expect(s).toContain("f2.ts");
    expect(s.indexOf("hub.ts")).toBeLessThan(s.indexOf("f2.ts"));
  });
  it("预算极小时只渲第一个文件(总含第一个)", () => {
    const s = renderSkeleton(many, { maxChars: 1 });
    expect(s).toContain("hub.ts");
    expect(s).not.toContain("f3.ts");
  });
  it("focusSymbols 改变排序：命中文件提前", () => {
    const s = renderSkeleton(files, { focusSymbols: ["target"], maxChars: 5000 });
    expect(s.indexOf("core.ts")).toBeLessThan(s.indexOf("unrelated.ts"));
  });
});
