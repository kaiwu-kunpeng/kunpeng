import { describe, expect, it } from "vitest";
import { scopeAllowFromRequirement } from "../../src/cli-commands/devcycle.js";
import { parseScopeDeclaration } from "../../src/verify/scope-gate.js";

const WITH_ALLOW = [
  "# 某 spec",
  "",
  "**实现要求**",
  "- 做点什么",
  "",
  "```scope",
  "allow: orchestrator/src/a.ts",
  "allow: orchestrator/test/a.test.ts",
  "forbid: orchestrator/src/b.ts",
  "```",
].join("\n");

const FORBID_ONLY = ["```scope", "forbid: orchestrator/src/b.ts", "```"].join("\n");

describe("scopeAllowFromRequirement", () => {
  it("抽出全部 allow 且顺序与声明一致", () => {
    expect(scopeAllowFromRequirement(WITH_ALLOW)).toEqual([
      "orchestrator/src/a.ts",
      "orchestrator/test/a.test.ts",
    ]);
  });

  it("只有 forbid 没有 allow 时返回 undefined 而非空数组", () => {
    expect(scopeAllowFromRequirement(FORBID_ONLY)).toBeUndefined();
  });

  it("没有 scope 围栏的自由文本需求返回 undefined 且不抛", () => {
    expect(scopeAllowFromRequirement("给我加个按钮，红色的")).toBeUndefined();
  });

  it("空串返回 undefined 且不抛", () => {
    expect(scopeAllowFromRequirement("")).toBeUndefined();
  });

  it("与 plan 路径的语义一致（同一文本得到同一 allow）", () => {
    const decl = parseScopeDeclaration(WITH_ALLOW);
    expect(scopeAllowFromRequirement(WITH_ALLOW)).toEqual(decl?.allow);
  });

  it("对畸形围栏不抛，最多返回 undefined 或已解析出的 allow", () => {
    const malformed = ["```scope", "这行既不是 allow 也不是 forbid", "```"].join("\n");
    expect(() => scopeAllowFromRequirement(malformed)).not.toThrow();
  });
});