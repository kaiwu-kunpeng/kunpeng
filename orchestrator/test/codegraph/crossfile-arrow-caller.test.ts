import { describe, it, expect } from "vitest";
import { buildCrossFileEdges } from "../../src/codegraph/cross-file.js";

const A = `export function alpha(): number { return 1; }\n`;

function edgesFor(bSource: string): { from: string; to: string; kind: string }[] {
  return buildCrossFileEdges([
    { path: "a.ts", source: A },
    { path: "b.ts", source: bSource },
  ]);
}

describe("箭头函数作为调用方的跨文件归属", () => {
  it("表达式体箭头函数产出跨文件边", () => {
    const edges = edgesFor(`import { alpha } from "./a.js";\nexport const beta = (): number => alpha();\n`);
    expect(edges).toContainEqual({ from: "b.ts#beta", to: "a.ts#alpha", kind: "calls" });
  });

  it("块体箭头函数产出跨文件边", () => {
    const edges = edgesFor(`import { alpha } from "./a.js";\nexport const beta = (): number => { return alpha(); };\n`);
    expect(edges).toContainEqual({ from: "b.ts#beta", to: "a.ts#alpha", kind: "calls" });
  });

  it("函数表达式产出跨文件边", () => {
    const edges = edgesFor(`import { alpha } from "./a.js";\nconst gamma = function (): number { return alpha(); };\n`);
    expect(edges).toContainEqual({ from: "b.ts#gamma", to: "a.ts#alpha", kind: "calls" });
  });

  it("匿名 export default 归属到 default", () => {
    const edges = edgesFor(`import { alpha } from "./a.js";\nexport default (): number => alpha();\n`);
    expect(edges).toContainEqual({ from: "b.ts#default", to: "a.ts#alpha", kind: "calls" });
  });

  it("传统 function 声明不回退", () => {
    const edges = edgesFor(`import { alpha } from "./a.js";\nexport function beta(): number { return alpha(); }\n`);
    expect(edges).toContainEqual({ from: "b.ts#beta", to: "a.ts#alpha", kind: "calls" });
  });

  it("顶层调用不产边", () => {
    const edges = edgesFor(`import { alpha } from "./a.js";\nalpha();\n`);
    expect(edges.filter((e) => e.kind === "calls")).toEqual([]);
  });

  it("imports 边照旧产出", () => {
    const edges = edgesFor(`import { alpha } from "./a.js";\nexport const beta = (): number => alpha();\n`);
    expect(edges).toContainEqual({ from: "b.ts", to: "a.ts", kind: "imports" });
  });
});