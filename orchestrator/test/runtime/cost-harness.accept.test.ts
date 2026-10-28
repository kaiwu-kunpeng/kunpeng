import { describe, expect, test } from "vitest";
import { parseCostReportArgs } from "../../src/cli-commands/reports.js";
import { buildHarnessYield, flowUsd, harnessOf, MIN_HARNESS_SAMPLE, renderHarnessYield, type HarnessFlow } from "../../src/runtime/cost-harness.js";
import { estimateCostUsd } from "../../src/runtime/cost-pricing.js";

const DAY = 86_400_000;
const NOW = 100 * DAY;

function flow(i: number, status: "verified" | "rolled-back", model: string, tokens: number, extra: Partial<HarnessFlow> = {}): HarnessFlow {
  return {
    flowId: `f-${model}-${i}`,
    status,
    startedAt: NOW - DAY,
    stageBackends: { implement: "codex", spec: "claude" },
    stageModels: { implement: model },
    stageTokens: { implement: tokens },
    ...extra,
  };
}

describe("harness 归类（作者锁定）", () => {
  test("implement 后端 × 模型 × effort；缺省 unknown / default", () => {
    expect(harnessOf(flow(0, "verified", "gpt-6-astra@xhigh", 1))).toEqual({ backend: "codex", model: "gpt-6-astra", effort: "xhigh" });
    expect(harnessOf({ backend: "claude", stageModels: { implement: "claude-opus-5" } })).toEqual({ backend: "claude", model: "claude-opus-5", effort: "default" });
    expect(harnessOf({})).toEqual({ backend: "unknown", model: "unknown", effort: "default" });
  });

  test("计价复用 estimateCostUsd，逐阶段按该阶段模型", () => {
    const f: HarnessFlow = { stageModels: { implement: "gpt-6-astra@xhigh" }, stageBackends: { spec: "claude" }, stageTokens: { implement: 2_000_000, spec: 500_000 } };
    const expected = estimateCostUsd({ "gpt-6-astra@xhigh": 2_000_000 }).totalUsd + estimateCostUsd({ claude: 500_000 }).totalUsd;
    expect(flowUsd(f)).toEqual({ tokens: 2_500_000, usd: expected });
  });
});

describe("每美元产出（作者锁定）", () => {
  const cheap = [0, 1, 2, 3, 4, 5].map((i) => flow(i, i < 5 ? "verified" : "rolled-back", "gpt-6-astra@xhigh", 100_000));
  const pricey = [0, 1, 2, 3, 4].map((i) => flow(i, i < 4 ? "verified" : "rolled-back", "gpt-5.6-sol@xhigh", 2_000_000));
  const thin = [flow(0, "verified", "claude-opus-5", 1_000_000, { stageBackends: { implement: "claude" } })];
  const noise: HarnessFlow[] = [
    { ...flow(9, "verified", "gpt-6-astra@xhigh", 1), flowId: "plan-abc" },
    { ...flow(10, "verified", "gpt-6-astra@xhigh", 1), status: "running" },
    { ...flow(11, "verified", "gpt-6-astra@xhigh", 1), startedAt: NOW - 40 * DAY },
  ];

  test("剔除壳流、未终结、窗口外；按每美元 verified 倒序，样本不足沉底", () => {
    const rows = buildHarnessYield([...pricey, ...thin, ...cheap, ...noise], { sinceMs: NOW - 30 * DAY });
    expect(rows.map((r) => `${r.model}:${r.flows}`)).toEqual(["gpt-6-astra:6", "gpt-5.6-sol:5", "claude-opus-5:1"]);
    const [a, b, c] = rows;
    expect(a!.verified).toBe(5);
    expect(a!.rollbackRate).toBeCloseTo(1 / 6);
    expect(a!.tokens).toBe(600_000);
    expect(a!.verifiedPerUsd!).toBeGreaterThan(b!.verifiedPerUsd!);
    expect(a!.insufficient).toBe(false);
    expect(b!.insufficient).toBe(false);
    expect(c!.insufficient).toBe(true);
    expect(MIN_HARNESS_SAMPLE).toBe(5);
  });

  test("渲染：一行一组，样本不足标注；空数据有提示", () => {
    const text = renderHarnessYield(buildHarnessYield([...cheap, ...thin], { sinceMs: 0 }), 30);
    expect(text).toContain("codex / gpt-6-astra / xhigh");
    expect(text).toContain("（样本不足）");
    expect(renderHarnessYield([], 7)).toContain("近 7 天");
  });

  test("cost-report 认得 --by-harness 与 --days，--days 非法报错，缺省 30 天", () => {
    const a = parseCostReportArgs(["--by-harness", "--days", "14"]);
    expect(a.ok && a.byHarness && a.days === 14).toBe(true);
    const b = parseCostReportArgs([]);
    expect(b.ok && !b.byHarness && b.days === 30).toBe(true);
    expect(parseCostReportArgs(["--by-harness", "--days", "0"]).ok).toBe(false);
    expect(parseCostReportArgs(["--days", "abc"]).ok).toBe(false);
  });
});