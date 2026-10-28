import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { buildCrossFileEdges } from "../../src/codegraph/cross-file.js";
import { buildGraphFromDir } from "../../src/codegraph/builder.js";

const A = `export function alpha(): number { return 1; }\n`;

function edgesFor(bSource: string): { from: string; to: string; kind: string }[] {
  return buildCrossFileEdges([
    { path: "a.ts", source: A },
    { path: "b.ts", source: bSource },
  ]);
}

describe("匿名回调里的跨文件调用归属到文件", () => {
  it("对象属性里的匿名箭头产出文件级 calls 边", () => {
    const edges = edgesFor(
      `import { alpha } from "./a.js";\nregister({ handle: async (): Promise<number> => alpha() });\n`,
    );
    expect(edges).toContainEqual({ from: "b.ts", to: "a.ts#alpha", kind: "calls" });
  });

  it("块体匿名回调同样产出", () => {
    const edges = edgesFor(
      `import { alpha } from "./a.js";\nregister({ handle: async (): Promise<number> => { return alpha(); } });\n`,
    );
    expect(edges).toContainEqual({ from: "b.ts", to: "a.ts#alpha", kind: "calls" });
  });

  it("具名函数内嵌匿名回调时归属仍是具名函数，不降级为文件", () => {
    const edges = edgesFor(
      `import { alpha } from "./a.js";\nexport function outer(): void { register({ handle: () => alpha() }); }\n`,
    );
    expect(edges).toContainEqual({ from: "b.ts#outer", to: "a.ts#alpha", kind: "calls" });
    expect(edges).not.toContainEqual({ from: "b.ts", to: "a.ts#alpha", kind: "calls" });
  });

  it("顶层裸调用仍不产边", () => {
    const edges = edgesFor(`import { alpha } from "./a.js";\nalpha();\n`);
    expect(edges.filter((e) => e.kind === "calls")).toEqual([]);
  });

  it("变量声明形态的箭头函数不回退", () => {
    const edges = edgesFor(`import { alpha } from "./a.js";\nexport const beta = (): number => alpha();\n`);
    expect(edges).toContainEqual({ from: "b.ts#beta", to: "a.ts#alpha", kind: "calls" });
  });
});

describe("file 节点", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cg-file-node-"));
    writeFileSync(join(dir, "a.ts"), A);
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.ts"), `import { alpha } from "../a.js";\nexport const beta = (): number => alpha();\n`);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("每个被索引文件都有 kind=file 的节点", () => {
    const g = buildGraphFromDir(dir);
    const files = g.search("a.ts").filter((n) => n.kind === "file");
    expect(files.length).toBeGreaterThan(0);
  });

  it("file 节点 id 用 POSIX 相对路径", () => {
    const g = buildGraphFromDir(dir);
    const sub = g.search("sub/b.ts").filter((n) => n.kind === "file");
    expect(sub.some((n) => n.id === "sub/b.ts")).toBe(true);
  });
});