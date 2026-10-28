import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { preDispatchLint } from "../../src/cli-commands/devcycle.js";
import { describeSpecRisk, SPEC_RISK_CALIBRATION, specRiskDecider, specRiskFeatures } from "../../src/plan/decide.js";
import { lintSpecText } from "../../src/plan/spec-lint.js";

const F = "`".repeat(3);
const repo = mkdtempSync(join(tmpdir(), "kp-spec-risk-"));
const TEST_BODY = 'import { expect, it } from "vitest";\nit("a", () => { expect(1).toBe(1); });';

function spec(opts: { allow?: string[]; bodyLines?: number; scope?: boolean } = {}): string {
  const allow = opts.allow ?? ["orchestrator/src/x.ts", "orchestrator/test/x.accept.test.ts"];
  const body = Array.from({ length: opts.bodyLines ?? 3 }, (_, i) => `正文第 ${i + 1} 行`);
  return [
    "# 风险夹具", ...body, "",
    ...(opts.scope === false ? [] : [`${F}scope`, ...allow.map((a) => `allow: ${a}`), F, ""]),
    `${F}accept-file path=orchestrator/test/x.accept.test.ts`, TEST_BODY, F, "",
    `${F}accept`, "cd orchestrator && env -u KUNPENG_BACKEND npx --no-install vitest run test/x.accept.test.ts", F, "",
  ].join("\n");
}

describe("spec 回滚风险：确定性打分（作者锁定）", () => {
  test("特征抽取", () => {
    const f = specRiskFeatures(spec({ allow: ["a.ts", "test/a.test.ts", "test/b.test.ts"] }));
    expect(f).toEqual({ noSpecShape: false, allowCount: 3, testAllowCount: 2, lineCount: f.lineCount });
    expect(specRiskFeatures("一句话需求：修一下登录").noSpecShape).toBe(true);
  });

  test("小而规整的 spec → 低；allow ≥ 7 条 → 中；再叠加改 2 个测试路径 → 高", () => {
    expect(specRiskDecider.decide(spec()).choice).toBe("低");
    const wide = Array.from({ length: 7 }, (_, i) => `orchestrator/src/m${i}.ts`);
    expect(specRiskDecider.decide(spec({ allow: wide })).choice).toBe("中");
    const wideTests = [...wide, "orchestrator/test/a.test.ts", "orchestrator/test/b.test.ts"];
    const high = specRiskDecider.decide(spec({ allow: wideTests }));
    expect(high.choice).toBe("高");
    expect(high.basis.join("；")).toContain("allow 9 条");
  });

  test("超长 spec 单独只到中；没有 scope 也没有锁定测试的一句话需求直接高", () => {
    expect(specRiskDecider.decide(spec({ bodyLines: 160 })).choice).toBe("中");
    expect(specRiskDecider.decide("把登录超时改成 30 秒").choice).toBe("高");
  });

  test("标定常量随档位单调递增，文案带历史回滚率与依据", () => {
    expect(SPEC_RISK_CALIBRATION.低).toBeLessThan(SPEC_RISK_CALIBRATION.中);
    expect(SPEC_RISK_CALIBRATION.中).toBeLessThan(SPEC_RISK_CALIBRATION.高);
    expect(describeSpecRisk(spec())).toBe("回滚风险：低（历史同档回滚率 4.4%）");
    expect(describeSpecRisk("一句话")).toContain("回滚风险：高（历史同档回滚率 19.7%；依据：没有 scope 块也没有锁定测试");
    expect(specRiskDecider.id).toBe("spec-risk-v1-deterministic");
  });
});

describe("spec-lint 与派流前闸：风险提示只是 info，绝不拦派（作者锁定）", () => {
  test("lintSpecText 带一条 info 级 spec-rollback-risk", () => {
    const risk = lintSpecText(spec(), repo).filter((i) => i.code === "spec-rollback-risk");
    expect(risk).toHaveLength(1);
    expect(risk[0]!.level).toBe("info");
    expect(risk[0]!.message).toContain("回滚风险：低");
  });

  test("高风险但无 error 的 spec：preDispatchLint 不拦，报告里能看到风险", () => {
    const wideTests = [...Array.from({ length: 7 }, (_, i) => `orchestrator/src/m${i}.ts`), "orchestrator/test/x.accept.test.ts", "orchestrator/test/b.test.ts"];
    const out = preDispatchLint(spec({ allow: wideTests }), repo, { acceptArgGiven: false });
    expect(out.blocked).toBe(false);
    expect(out.report).toContain("回滚风险：高");
  });
});