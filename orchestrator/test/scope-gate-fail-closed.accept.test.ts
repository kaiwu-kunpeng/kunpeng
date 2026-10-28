import { describe, expect, test } from "vitest";
import { detectScopeDrift, parseScopeDeclaration } from "../src/verify/scope-gate.js";

const CHANGED = ["constitution/core.md", "orchestrator/src/anything.ts"];
const fence = (body: string) => ["```scope", body, "```"].join("\n");

describe("范围门解析失败必须 fail-closed", () => {
  test("正常 allow 不回归", () => {
    const decl = parseScopeDeclaration(fence("allow: orchestrator/src/cli.ts"));
    expect(decl).toBeDefined();
    expect(decl!.allow).toEqual(["orchestrator/src/cli.ts"]);
    expect(decl!.malformed ?? false).toBe(false);
    expect(detectScopeDrift(CHANGED, decl!).violations.length).toBe(2);
  });

  test("全角冒号必须能解析出 glob", () => {
    const decl = parseScopeDeclaration(fence("allow：orchestrator/src/cli.ts"));
    expect(decl!.allow).toEqual(["orchestrator/src/cli.ts"]);
    expect(decl!.malformed ?? false).toBe(false);
  });

  test("YAML 列表写法必须能解析出 glob", () => {
    const decl = parseScopeDeclaration(fence("allow:\n- orchestrator/src/cli.ts\n- orchestrator/src/a.ts"));
    expect(decl!.allow).toEqual(["orchestrator/src/cli.ts", "orchestrator/src/a.ts"]);
    expect(decl!.malformed ?? false).toBe(false);
  });

  test("fence 存在但完全解析不出 → malformed，且每个文件都判越界", () => {
    const decl = parseScopeDeclaration(fence("这里全是说明文字，没有任何键"));
    expect(decl).toBeDefined();
    expect(decl!.malformed).toBe(true);
    const violations = detectScopeDrift(CHANGED, decl!).violations;
    expect(violations.length).toBe(CHANGED.length);
    expect(violations.every((v) => v.rule === "scope-unparseable")).toBe(true);
    expect(violations.map((v) => v.file).sort()).toEqual([...CHANGED].sort());
  });

  test("空 fence 同样 fail-closed", () => {
    const decl = parseScopeDeclaration(fence(""));
    expect(decl!.malformed).toBe(true);
    expect(detectScopeDrift(["constitution/core.md"], decl!).violations.length).toBe(1);
  });

  test("没有 scope fence 时仍返回 undefined（跳过语义不变）", () => {
    expect(parseScopeDeclaration("# 一份没有 scope 块的 spec")).toBeUndefined();
  });

  test("只有 forbid 也算解析成功，不得判 malformed", () => {
    const decl = parseScopeDeclaration(fence("forbid: constitution/**"));
    expect(decl!.malformed ?? false).toBe(false);
    expect(decl!.forbid).toEqual(["constitution/**"]);
  });
});