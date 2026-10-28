import { describe, expect, it } from "vitest";
import {
  EVAL_ASSET_RULES,
  EVAL_TAMPER_KIND,
  evalAssetRefsFromAcceptance,
  findEvalAssetViolations,
  formatEvalTamperMessage,
} from "../../src/verify/eval-asset-guard.js";
import { classifyFailureText } from "../../src/loop/rollback-attribution.js";

// 09-16/09-17 真机事故:巡检评测在主工作区把这个文件清成 0 字节。守卫必须把它当评测资产。
const INCIDENT_FILE = "orchestrator/test/server/architecture-graph.test.ts";

describe("评测资产清单（作者锁定）", () => {
  it("测试目录、回归库、适应度基线、评测代码、验证门源码都在清单里", () => {
    const labels = (file: string) => EVAL_ASSET_RULES.filter((r) => r.pattern.test(file)).map((r) => r.label);
    expect(labels(INCIDENT_FILE)).not.toEqual([]);
    expect(labels(".kunpeng/regression/h866805080.json")).not.toEqual([]);
    expect(labels(".kunpeng/state/fitness-baseline.json")).not.toEqual([]);
    expect(labels("orchestrator/src/evolution/eval-runner.ts")).not.toEqual([]);
    expect(labels("orchestrator/src/evolution/fitness-baseline.ts")).not.toEqual([]);
    expect(labels("orchestrator/src/evolution/regression-store.ts")).not.toEqual([]);
    expect(labels("orchestrator/src/verify/scope-gate.ts")).not.toEqual([]);
    expect(labels("orchestrator/src/loop/audit.ts")).not.toEqual([]);
    expect(labels("orchestrator/vitest.config.ts")).not.toEqual([]);
  });

  it("普通源码、文档、机器 spec 副本不在清单里", () => {
    // 客户项目根下的 test/ 有意不纳入（见实现要求规则 1）
    for (const file of ["orchestrator/src/loop/dev-cycle.ts", "orchestrator/src/evolution/policy.ts", "docs/specs/x.md", "README.md", "orchestrator/testing-notes.md", "test/evolution/fitness.test.ts"]) {
      expect(EVAL_ASSET_RULES.some((r) => r.pattern.test(file)), file).toBe(false);
    }
  });
});

describe("findEvalAssetViolations（作者锁定）", () => {
  it("没有 scope allow 时，任何评测资产改动都是越界；普通文件不算", () => {
    const violations = findEvalAssetViolations({
      changedFiles: ["orchestrator/src/loop/dev-cycle.ts", INCIDENT_FILE, ".kunpeng/regression/abc.json", INCIDENT_FILE],
      allowGlobs: [],
    });
    expect(violations.map((v) => v.file)).toEqual([INCIDENT_FILE, ".kunpeng/regression/abc.json"]);
    expect(violations.every((v) => v.label.length > 0)).toBe(true);
  });

  it("scope allow 显式覆盖的评测资产放行，未覆盖的仍拦", () => {
    const violations = findEvalAssetViolations({
      changedFiles: ["orchestrator/test/verify/new.test.ts", INCIDENT_FILE, "orchestrator/src/verify/scope-gate.ts"],
      allowGlobs: ["orchestrator/test/verify/**", "orchestrator/src/loop/**"],
    });
    expect(violations.map((v) => v.file)).toEqual([INCIDENT_FILE, "orchestrator/src/verify/scope-gate.ts"]);
  });

  it("作者锁定文件豁免（loop 每次 verify 前都会覆写它们）", () => {
    const violations = findEvalAssetViolations({
      changedFiles: ["orchestrator/test/verify/locked.test.ts", "orchestrator/test/verify/other.test.ts"],
      allowGlobs: [],
      exemptPaths: ["./orchestrator/test/verify/locked.test.ts"],
    });
    expect(violations.map((v) => v.file)).toEqual(["orchestrator/test/verify/other.test.ts"]);
  });

  it("验收命令引用的脚本/测试文件也是评测资产：cd 后的相对路径要折算", () => {
    const cmd = "cd orchestrator && test -f test/verify/locked.test.ts && node scripts/check-thing.mjs && env -u X npx --no-install vitest run scope-gate";
    expect(evalAssetRefsFromAcceptance(cmd)).toEqual(["orchestrator/test/verify/locked.test.ts", "orchestrator/scripts/check-thing.mjs"]);
    const violations = findEvalAssetViolations({
      changedFiles: ["orchestrator/scripts/check-thing.mjs", "orchestrator/scripts/unrelated.mjs"],
      allowGlobs: ["orchestrator/src/**"],
      acceptanceCmd: cmd,
    });
    expect(violations).toEqual([{ file: "orchestrator/scripts/check-thing.mjs", label: "验收命令引用文件" }]);
    expect(findEvalAssetViolations({
      changedFiles: ["orchestrator/scripts/check-thing.mjs"],
      allowGlobs: ["orchestrator/scripts/**"],
      acceptanceCmd: cmd,
    })).toEqual([]);
  });

  it("文案与归因：消息以「评测资产守卫」开头、点名文件，归因 kind 固定 eval-tamper", () => {
    const message = formatEvalTamperMessage([{ file: INCIDENT_FILE, label: "测试目录" }]);
    expect(message.startsWith("评测资产守卫")).toBe(true);
    expect(message).toContain(INCIDENT_FILE);
    expect(EVAL_TAMPER_KIND).toBe("eval-tamper");
    expect(classifyFailureText(message).kind).toBe("eval-tamper");
    expect(classifyFailureText("范围门：改动了 allow 之外的文件 src/x.ts").kind).toBe("scope-gate");
  });
});