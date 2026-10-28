import { cacheHitRate, hitRateGrade } from "./cache-cost.js";
import { retention } from "./retention.js";

export interface WeeklyFlow {
  id: string;
  status: string;
  at: number;
  merged?: boolean;
  usd?: number;
  tokens?: {
    input: number;
    output: number;
    cacheCreate: number;
    cacheRead: number;
  };
}

export interface WeeklyInput {
  flows: WeeklyFlow[];
  sinceMs: number;
  untilMs: number;
}

type TokenKey = "input" | "output" | "cacheCreate" | "cacheRead";

function token(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function dateLabel(value: number): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "n/a";
}

function flowOutput(flow: WeeklyFlow): number {
  return token(flow.tokens?.output);
}

function compareTopFlows(left: WeeklyFlow, right: WeeklyFlow): number {
  const leftHasUsd = typeof left.usd === "number" && Number.isFinite(left.usd);
  const rightHasUsd = typeof right.usd === "number" && Number.isFinite(right.usd);
  if (leftHasUsd !== rightHasUsd) return leftHasUsd ? -1 : 1;

  const leftValue = leftHasUsd ? left.usd as number : flowOutput(left);
  const rightValue = rightHasUsd ? right.usd as number : flowOutput(right);
  return rightValue - leftValue || left.id.localeCompare(right.id);
}

function topFlowLine(flow: WeeklyFlow, index: number): string {
  if (typeof flow.usd === "number" && Number.isFinite(flow.usd)) {
    return `${index + 1}. ${flow.id} — USD $${flow.usd.toFixed(4)}`;
  }
  return `${index + 1}. ${flow.id} — output ${flowOutput(flow)} tokens`;
}

/** 汇总指定半开区间内的 flow，生成一页 Markdown 周报。 */
export function buildWeeklyReport(input: WeeklyInput): string {
  const flows = input.flows.filter((flow) =>
    Number.isFinite(flow.at) && flow.at >= input.sinceMs && flow.at < input.untilMs,
  );
  const lines = [
    "# 用量周报",
    "",
    `统计区间：${dateLabel(input.sinceMs)} 至 ${dateLabel(input.untilMs)}（结束时间不含）`,
  ];

  if (flows.length === 0) {
    return [...lines, "", "本周无流量"].join("\n");
  }

  const verified = flows.filter((flow) => flow.status === "verified").length;
  const failed = flows.filter((flow) => flow.status === "failed").length;
  const successRate = (verified / flows.length) * 100;
  lines.push(
    "",
    "## 流量",
    "",
    `- 总流数：${flows.length}`,
    `- verified：${verified}`,
    `- 失败（status === "failed"）：${failed}`,
    `- 成功率：${successRate.toFixed(1)}%`,
  );

  const totals: Record<TokenKey, number> = {
    input: 0,
    output: 0,
    cacheCreate: 0,
    cacheRead: 0,
  };
  for (const flow of flows) {
    for (const key of Object.keys(totals) as TokenKey[]) {
      totals[key] += token(flow.tokens?.[key]);
    }
  }
  const rate = cacheHitRate({
    input: totals.input,
    cacheCreate: totals.cacheCreate,
    cacheRead: totals.cacheRead,
  });
  const grade = hitRateGrade(rate);
  const rateText = rate === null ? grade : `${(rate * 100).toFixed(1)}%（${grade}）`;
  lines.push(
    "",
    "## Token 四象限",
    "",
    `- input：${totals.input}`,
    `- cacheCreate：${totals.cacheCreate}`,
    `- cacheRead：${totals.cacheRead}`,
    `- output：${totals.output}`,
    `- 缓存命中率：${rateText}`,
  );

  const pricedFlows = flows.filter(
    (flow): flow is WeeklyFlow & { usd: number } => typeof flow.usd === "number" && Number.isFinite(flow.usd),
  );
  lines.push("", "## 成本", "");
  if (pricedFlows.length > 0) {
    const totalUsd = pricedFlows.reduce((sum, flow) => sum + flow.usd, 0);
    lines.push(`- 美元合计：$${totalUsd.toFixed(4)}`);
  } else {
    lines.push("- 暂无可计费 USD 数据");
  }

  lines.push("", "## Top 3 最贵流", "");
  lines.push(...[...flows].sort(compareTopFlows).slice(0, 3).map(topFlowLine));

  const generated = flows.length;
  const committed = flows.filter((flow) => flow.status === "verified").length;
  const inProd = flows.filter((flow) => flow.merged === true).length;
  const r = retention({ generated, committed, inProd });
  lines.push(
    "",
    "## 留存漏斗",
    "",
    `产出 ${generated} → 过审 ${committed}(提交率 ${(r.commitRate * 100).toFixed(0)}%) → 合入 ${inProd}(存活率 ${(r.survivalRate * 100).toFixed(0)}%,返工率 ${(r.reworkRate * 100).toFixed(0)}%)`,
  );
  return lines.join("\n");
}
