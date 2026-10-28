import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintSpecText } from "../../src/plan/spec-lint.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-vacuous-"));
  mkdirSync(join(repo, "orchestrator", "src"), { recursive: true });
  mkdirSync(join(repo, "orchestrator", "test"), { recursive: true });
  writeFileSync(join(repo, "orchestrator", "src", "a.ts"), "export const alreadyHere = 1;\n");
  writeFileSync(join(repo, "orchestrator", "test", "a.test.ts"), "//\n");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

/** 造一份除 accept 外都合法的 spec；accept 由调用方给。 */
function spec(acceptBody: string): string {
  return [
    "```scope",
    "allow: orchestrator/src/a.ts",
    "```",
    "",
    "# 段",
    "正文",
    "",
    "```accept",
    acceptBody,
    "```",
    "",
  ].join("\n");
}

const codes = (md: string) => lintSpecText(md, repo).map((i) => i.code);
const vacuous = (md: string) => lintSpecText(md, repo).filter((i) => i.code === "accept-assertion-vacuous");

describe("空转验收断言（正向 grep 在当前代码上已成立）", () => {
  it("正向断言已成立 → 出 warn，且点名模式与文件", () => {
    const md = spec('cd orchestrator && grep -q "alreadyHere" src/a.ts && npx vitest run test/a.test.ts');
    const hit = vacuous(md);
    expect(hit.length).toBe(1);
    expect(hit[0].message).toContain("alreadyHere");
    expect(hit[0].message).toContain("src/a.ts");
  });

  it("该 issue 必须是 warn 而非 error —— 不许挡住 plan 自主发射", () => {
    const md = spec('cd orchestrator && grep -q "alreadyHere" src/a.ts && npx vitest run test/a.test.ts');
    expect(vacuous(md)[0].level).toBe("warn");
  });

  it("正向断言当前不成立 → 不报（这是有效断言）", () => {
    const md = spec('cd orchestrator && grep -q "notYetImplemented" src/a.ts && npx vitest run test/a.test.ts');
    expect(vacuous(md)).toHaveLength(0);
  });

  it("文件定位不到 → 不报（fail-safe：本流将新建的文件不算空转）", () => {
    const md = spec('cd orchestrator && grep -q "anything" src/will-be-created.ts && npx vitest run test/a.test.ts');
    expect(vacuous(md)).toHaveLength(0);
  });

  it("负向断言即使已成立也不报 —— 防回归护栏不是噪声", () => {
    const md = spec('cd orchestrator && ! grep -q "processEnvVitest" src/a.ts && npx vitest run test/a.test.ts');
    expect(vacuous(md)).toHaveLength(0);
  });

  it("按 accept 里的 cd 解析文件：不带 cd 时同一条断言定位不到，因而不报", () => {
    const withCd = spec('cd orchestrator && grep -q "alreadyHere" src/a.ts && npx vitest run test/a.test.ts');
    const noCd = spec('grep -q "alreadyHere" src/a.ts && npx vitest run orchestrator/test/a.test.ts');
    expect(vacuous(withCd)).toHaveLength(1);
    expect(vacuous(noCd)).toHaveLength(0);
  });

  it("accept 里没有 grep 断言 → 不报该 warn", () => {
    const md = spec("cd orchestrator && npx vitest run test/a.test.ts");
    expect(codes(md)).not.toContain("accept-assertion-vacuous");
  });

  it("干净 spec 的 error 数不受影响（新规则只加 warn）", () => {
    const md = spec('cd orchestrator && grep -q "alreadyHere" src/a.ts && npx vitest run test/a.test.ts');
    expect(lintSpecText(md, repo).filter((i) => i.level === "error")).toHaveLength(0);
  });
});