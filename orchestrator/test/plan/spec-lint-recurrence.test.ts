import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatLintReport, lintSpecText } from "../../src/plan/spec-lint.js";

// 本文件整体嵌在 spec 围栏里,正文不能出现三个反引号。
const FENCE = "`".repeat(3);
const SPEC = [
  "# 示例流",
  "",
  `${FENCE}scope`,
  "allow: src/**",
  FENCE,
  "",
  `${FENCE}accept`,
  "grep -q hello README.md",
  FENCE,
  "",
].join("\n");

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-lint-recur-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const recurring = (cwd: string) => lintSpecText(SPEC, cwd).filter((i) => i.code.startsWith("recurring-rollback:"));

describe("spec-lint 读回滚复发规则（作者锁定）", () => {
  it("没有规则文件 → 没有 recurring-rollback 条目", () => {
    expect(recurring(dir)).toEqual([]);
  });

  it("有规则文件 → 每条规则一条 info，文案含计数与提示；不产生 warn/error", () => {
    mkdirSync(join(dir, ".kunpeng"), { recursive: true });
    writeFileSync(join(dir, ".kunpeng", "spec-lint-rules.json"), JSON.stringify({
      generatedAt: 1, sinceDays: 14,
      rules: [
        { code: "recurring-rollback:test-failed", kind: "test-failed", count: 4, sample: "FAIL test/a.test.ts > x · AssertionError", hint: "先在 main 上跑作者测试，确认红在该红处", flowIds: ["a", "b"] },
        { code: "recurring-rollback:timeout", kind: "timeout", count: 3, sample: "命令超时被杀", hint: "验收要塞进单步预算", flowIds: ["c"] },
      ],
    }), "utf8");
    const issues = recurring(dir);
    expect(issues.map((i) => [i.level, i.code])).toEqual([["info", "recurring-rollback:test-failed"], ["info", "recurring-rollback:timeout"]]);
    expect(issues[0]!.message).toContain("4 条流");
    expect(issues[0]!.message).toContain("test-failed");
    expect(issues[0]!.message).toContain("先在 main 上跑作者测试");
    const all = lintSpecText(SPEC, dir);
    expect(all.filter((i) => i.level === "error")).toEqual([]);
    expect(all.filter((i) => i.level === "warn" && i.code.startsWith("recurring-rollback:"))).toEqual([]);
  });

  it("formatLintReport：只有 info 时不报「校验通过」，单独一段提示，没有错误/告警段", () => {
    const report = formatLintReport([{ level: "info", code: "recurring-rollback:lint", message: "近期 3 条流因 lint 回滚" }]);
    expect(report).not.toContain("✅");
    expect(report).toContain("ℹ️ 提示 (1)");
    expect(report).toContain("[recurring-rollback:lint]");
    expect(report).not.toContain("❌");
    expect(report).not.toContain("⚠️");
    expect(formatLintReport([])).toBe("✅ spec 校验通过");
  });
});