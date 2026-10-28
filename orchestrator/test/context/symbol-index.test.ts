import { describe, it, expect } from "vitest";
import { extractFileSymbols, buildSymbolGraph, rankFiles } from "../../src/context/symbol-index.js";

describe("extractFileSymbols", () => {
  it("抽各种 export 形式", () => {
    const src = [
      "export function foo() {}",
      "export async function bar() {}",
      "export const baz = 1;",
      "export class Qux {}",
      "export interface IFace {}",
      "export type T = number;",
      "export enum E { A }",
      "export default function () {}",
      "export { hidden as shown, plain };",
    ].join("\n");
    const r = extractFileSymbols(src);
    expect(r.exports).toContain("foo");
    expect(r.exports).toContain("bar");
    expect(r.exports).toContain("baz");
    expect(r.exports).toContain("Qux");
    expect(r.exports).toContain("IFace");
    expect(r.exports).toContain("T");
    expect(r.exports).toContain("E");
    expect(r.exports).toContain("default");
    expect(r.exports).toContain("shown");
    expect(r.exports).toContain("plain");
    expect(r.exports).not.toContain("hidden");
  });

  it("抽 importFroms（含副作用 import，排除 export-from）", () => {
    const src = [
      "import { a } from './m';",
      "import def from \"./n\";",
      "import * as ns from './p';",
      "import './side';",
      "export * from './reexport';",
    ].join("\n");
    const r = extractFileSymbols(src);
    expect(r.importFroms).toEqual(["./m", "./n", "./p", "./side"]);
  });

  it("去重", () => {
    const r = extractFileSymbols("import './x';\nimport { y } from './x';\nexport const z=1;\nexport const z2=2;");
    expect(r.importFroms).toEqual(["./x"]);
    expect(r.exports).toEqual(["z", "z2"]);
  });
});

describe("buildSymbolGraph", () => {
  it("解析相对 import 边并算 refs（不同文件计数、去扩展名、去 /index）", () => {
    const files = [
      { path: "a/foo.ts", source: "export const foo = 1;\nexport const bar = 2;" },
      { path: "a/baz.ts", source: "import { foo } from './foo.js';\nimport './foo';" },
      { path: "a/qux.ts", source: "import { foo } from './foo';" },
      { path: "a/idx/index.ts", source: "export const k = 1;" },
      { path: "a/uses-idx.ts", source: "import { k } from './idx';" },
    ];
    const g = buildSymbolGraph(files);
    const foo = g.nodes.find((n) => n.path === "a/foo.ts")!;
    expect(foo.refs).toBe(2); // baz + qux（baz 两次 import 只算一次）
    expect(foo.exports).toEqual(["foo", "bar"]);
    const idx = g.nodes.find((n) => n.path === "a/idx/index.ts")!;
    expect(idx.refs).toBe(1); // './idx' 命中 /index
    expect(g.nodes.map((n) => n.path)).toEqual(files.map((f) => f.path)); // 顺序一致
  });

  it("外部包 import 不产生边；自引用不计", () => {
    const files = [
      { path: "x.ts", source: "import fs from 'node:fs';\nimport './x';\nexport const v=1;" },
    ];
    const g = buildSymbolGraph(files);
    expect(g.nodes[0].refs).toBe(0);
  });
});

describe("rankFiles", () => {
  it("按 refs 降序、exports 降序、path 升序", () => {
    const files = [
      { path: "low.ts", source: "export const a=1;" },
      { path: "hub.ts", source: "export const h=1;" },
      { path: "b.ts", source: "import './hub';\nexport const x=1;\nexport const y=2;" },
      { path: "c.ts", source: "import './hub';" },
    ];
    const ranked = rankFiles(files);
    expect(ranked[0].path).toBe("hub.ts"); // refs=2 最高
    expect(ranked[0].refs).toBe(2);
    // 其余 refs=0：按 exports 降序(b 有2个) 再 path 升序
    const rest = ranked.slice(1).map((r) => r.path);
    expect(rest[0]).toBe("b.ts");
    expect(rest.slice(1)).toEqual(["c.ts", "low.ts"]);
  });
});
