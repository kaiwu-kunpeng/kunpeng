import { describe, it, expect } from "vitest";
import { buildCrossFileEdges, collectImportBindings, resolveImportPath } from "../../src/codegraph/cross-file.js";

const A = `export function alpha(): number { return 1; }\n`;
const B = `import { alpha } from "./a.js";\nexport function beta(): number { return alpha(); }\n`;

describe("resolveImportPath", () => {
  it("相对 import 的 .js 映射回 .ts", () => {
    expect(resolveImportPath("b.ts", "./a.js")).toBe("a.ts");
    expect(resolveImportPath("src/x/b.ts", "../y/c.js")).toBe("src/y/c.ts");
  });

  it("第三方与 node 内置返回 undefined", () => {
    expect(resolveImportPath("b.ts", "typescript")).toBeUndefined();
    expect(resolveImportPath("b.ts", "node:fs")).toBeUndefined();
  });
});

describe("collectImportBindings", () => {
  it("具名导入与重命名导入都解析出来", () => {
    const bindings = collectImportBindings("b.ts", `import { alpha, gamma as g } from "./a.js";`);
    expect(bindings).toEqual([
      { local: "alpha", targetFile: "a.ts", exportedName: "alpha" },
      { local: "g", targetFile: "a.ts", exportedName: "gamma" },
    ]);
  });

  it("第三方 import 被跳过", () => {
    expect(collectImportBindings("b.ts", `import ts from "typescript";`)).toEqual([]);
  });
});

describe("buildCrossFileEdges", () => {
  const files = [{ path: "a.ts", source: A }, { path: "b.ts", source: B }];

  it("建出 B.beta → A.alpha 的跨文件 calls 边（当前必红）", () => {
    const edges = buildCrossFileEdges(files);
    expect(edges).toContainEqual({ from: "b.ts#beta", to: "a.ts#alpha", kind: "calls" });
  });

  it("建出 b.ts → a.ts 的 imports 边", () => {
    const edges = buildCrossFileEdges(files);
    expect(edges).toContainEqual({ from: "b.ts", to: "a.ts", kind: "imports" });
  });

  it("文件内调用不被重复产边", () => {
    const local = [{ path: "c.ts", source: `function one(): number { return 1; }\nfunction two(): number { return one(); }\n` }];
    const edges = buildCrossFileEdges(local).filter((e) => e.kind === "calls");
    expect(edges).toEqual([]);
  });

  it("第三方 import 不炸也不产边", () => {
    const third = [{ path: "d.ts", source: `import ts from "typescript";\nexport function f(): number { return 1; }\n` }];
    expect(buildCrossFileEdges(third)).toEqual([]);
  });
});