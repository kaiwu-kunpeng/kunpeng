import { describe, it, expect } from "vitest";
import { parseSource } from "../../src/codegraph/parser.js";

function names(src: string): string[] {
  return parseSource("x.ts", src).nodes.map((n) => n.name).sort();
}

describe("收录现代 TS 写法", () => {
  it("箭头函数进符号表", () => {
    expect(names(`export const alpha = (): number => 1;\n`)).toContain("alpha");
  });

  it("函数表达式进符号表", () => {
    expect(names(`const gamma = function (): number { return 3; };\n`)).toContain("gamma");
  });

  it("匿名 export default 以 default 为名", () => {
    expect(names(`export default (): number => 1;\n`)).toContain("default");
  });

  it("箭头函数节点 kind 为 function", () => {
    const { nodes } = parseSource("x.ts", `export const alpha = (): number => 1;\n`);
    expect(nodes.find((n) => n.name === "alpha")?.kind).toBe("function");
  });

  it("传统写法仍收录且不重复", () => {
    const { nodes } = parseSource("x.ts", `export function beta(): number { return 2; }\n`);
    expect(nodes.filter((n) => n.name === "beta").length).toBe(1);
  });

  it("四种写法同时出现时全部收录", () => {
    const src = `export const alpha = (): number => 1;\n`
      + `export function beta(): number { return 2; }\n`
      + `const gamma = function (): number { return 3; };\n`
      + `export class Delta {}\n`;
    const got = names(src);
    for (const n of ["alpha", "beta", "gamma", "Delta"]) {
      expect(got, `缺: ${n}`).toContain(n);
    }
  });
});

describe("新收录项的调用边", () => {
  it("箭头函数块体内的调用产出 calls 边", () => {
    const src = `function target(): number { return 1; }\n`
      + `export const caller = (): number => { return target(); };\n`;
    const { nodes, edges } = parseSource("x.ts", src);
    const id = (n: string) => nodes.find((x) => x.name === n)?.id;
    expect(edges.some((e) => e.kind === "calls" && e.from === id("caller") && e.to === id("target"))).toBe(true);
  });

  it("表达式体箭头函数内的调用也产出 calls 边", () => {
    const src = `function target(): number { return 1; }\n`
      + `export const caller = (): number => target();\n`;
    const { nodes, edges } = parseSource("x.ts", src);
    const id = (n: string) => nodes.find((x) => x.name === n)?.id;
    expect(edges.some((e) => e.kind === "calls" && e.from === id("caller") && e.to === id("target"))).toBe(true);
  });
});