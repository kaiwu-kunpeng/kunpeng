import { describe, it, expect } from "vitest";
import { stateSource } from "../helpers/state-source.js";

// 防回归（ADR-0011）：规范代码状态（行数/过审行数）必须从 git ref 数，不读工作树。
// 若有人把 countSrcTest 改回纯文件系统扫描（去掉 ref 读），本测试红。
const stateSrc = stateSource();

describe("LOC 规范读 ref 防回归 (ADR-0011)", () => {
  it("state.ts 导入 ref 读 helper countLinesFromRef", () => {
    expect(stateSrc).toContain("countLinesFromRef");
    expect(stateSrc).toContain("loc-ref");
  });

  it("countSrcTest 函数体内确实用 countLinesFromRef 从 main 数(非仅文件系统)", () => {
    const start = stateSrc.indexOf("async function countSrcTest");
    expect(start).toBeGreaterThan(-1);
    const body = stateSrc.slice(start, start + 1500);
    expect(body).toContain("countLinesFromRef");
    expect(body).toContain('"main"');
  });
});
