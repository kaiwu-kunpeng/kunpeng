import { describe, it, expect } from "vitest";
import { detectScopeDrift, parseScopeDeclaration } from "../../src/verify/scope-gate.js";

const good = [
  "```scope",
  "allow: orchestrator/src/foo.ts",
  "forbid: orchestrator/src/loop/**",
  "```",
].join("\n");

const crooked = [
  "```scope",
  "allow: orchestrator/src/foo.ts",
  "forbid orchestrator/src/loop/**",
  "```",
].join("\n");

describe("格式正确时不受影响", () => {
  it("malformed 不置位且内容正确", () => {
    const d = parseScopeDeclaration(good);
    expect(d?.malformed).not.toBe(true);
    expect(d?.allow).toEqual(["orchestrator/src/foo.ts"]);
    expect(d?.forbid).toEqual(["orchestrator/src/loop/**"]);
  });

  it("空行与注释行不触发 malformed", () => {
    const withNoise = [
      "```scope",
      "allow: orchestrator/src/foo.ts",
      "",
      "# 这是注释",
      "forbid: orchestrator/src/loop/**",
      "```",
    ].join("\n");
    expect(parseScopeDeclaration(withNoise)?.malformed).not.toBe(true);
  });
});

describe("一行好一行歪必须判 malformed", () => {
  it("forbid 漏冒号 → malformed", () => {
    expect(parseScopeDeclaration(crooked)?.malformed).toBe(true);
  });

  it("歪行不再被静默丢弃成「只剩 allow」", () => {
    const d = parseScopeDeclaration(crooked);
    expect(d, "应解析出声明").toBeTruthy();
    expect(d?.malformed, "歪行必须让整个声明 fail-closed").toBe(true);
  });

  it("多块中任一块有歪行即整体 malformed", () => {
    const two = `${good}\n\n${crooked}`;
    expect(parseScopeDeclaration(two)?.malformed).toBe(true);
  });
});

describe("运行时范围门因此 fail-closed", () => {
  it("有歪行时任何改动都判不通过且 rule 为 scope-unparseable", () => {
    const d = parseScopeDeclaration(crooked);
    const r = detectScopeDrift(["orchestrator/src/loop/dev-cycle.ts"], d!);
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.rule)).toContain("scope-unparseable");
  });

  it("有歪行但改动为空时放行（与既有 malformed 语义一致）", () => {
    const d = parseScopeDeclaration(crooked);
    expect(detectScopeDrift([], d!).ok).toBe(true);
  });

  it("格式正确时 forbid 仍然真正生效", () => {
    const d = parseScopeDeclaration(good);
    const r = detectScopeDrift(["orchestrator/src/loop/dev-cycle.ts"], d!);
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.rule)).toContain("forbidden");
  });
});

describe("整块解析不出的既有行为不回退", () => {
  it("allow 与 forbid 全空仍为 malformed", () => {
    const empty = ["```scope", "随便一行不成立的内容", "```"].join("\n");
    expect(parseScopeDeclaration(empty)?.malformed).toBe(true);
  });

  it("没有 scope 块时返回 undefined", () => {
    expect(parseScopeDeclaration("# 没有 scope 块")).toBeUndefined();
  });
});