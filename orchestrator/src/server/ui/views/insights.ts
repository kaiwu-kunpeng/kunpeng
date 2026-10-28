import type { DashboardState } from "../../state.js";
import { escHtml as escapeHtml } from "../../../util/esc-html.js";

function formatNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("zh-CN")
    : "0";
}

function renderMetric(value: unknown, label: string, tone = "neu"): string {
  return `<div class="kpi ${tone}"><div><div class="n">${escapeHtml(value)}</div><div class="l">${escapeHtml(label)}</div></div></div>`;
}

/**
 * `qualityGateStats` is prepared on the server from `readWeeklyFlows`,
 * `readRecentFailureItems` + `clusterFailures`, and
 * `rolledBackFlowIdsFromStates`. This view deliberately only renders state.
 */
function renderQualityGates(state: Pick<DashboardState, "qualityGateStats">): string {
  const stats = state.qualityGateStats;
  const verified = !stats || stats.verified30d.status === "error"
    ? "数据读取失败"
    : stats.verified30d.total === 0
      ? "暂无数据"
      : `${((stats.verified30d.verified / stats.verified30d.total) * 100).toFixed(1)}%`;
  const failures = !stats || stats.failures7d.status === "error"
    ? "数据读取失败"
    : formatNumber(stats.failures7d.count);
  const patterns = !stats || stats.failures7d.status === "error"
    ? "数据读取失败"
    : stats.failures7d.patterns.length === 0
      ? "暂无数据"
      : stats.failures7d.patterns
          .slice(0, 3)
          .map(({ signature, count }) => `${signature.slice(0, 60)}${signature.length > 60 ? "…" : ""} ×${count}`)
          .join("；");
  const rolledBack = !stats || stats.rolledBackTotal.status === "error"
    ? "数据读取失败"
    : formatNumber(stats.rolledBackTotal.count);

  return `<div class="kpis" data-panel="insights-gates">
    ${renderMetric(verified, "Verified 率 · 近 30 天（完成与失败流）", "suc")}
    ${renderMetric(failures, "失败流数 · 近 7 天", "wrn")}
    ${renderMetric(patterns, "Top 失败模式 · 近 7 天（前三）")}
    ${renderMetric(rolledBack, "Rolled-back 总数 · 历史累计", "pri")}
  </div>`;
}

function renderRollbackHeatmap(state: Pick<DashboardState, "rollbackHeatmap">): string {
  const h = state.rollbackHeatmap;
  if (!h || h.coverage.total === 0) {
    return `<div class="run empty"><span class="name">暂无回滚</span></div>`;
  }
  const rows = h.kinds.map((kind) => {
    const cells = h.cells.filter((cell) => cell.kind === kind);
    const summarizeBackends = (stage?: string): string => h.backends
      .map((backend) => ({
        backend,
        count: cells.filter((cell) => cell.backend === backend && (stage === undefined || cell.stage === stage))
          .reduce((sum, cell) => sum + cell.count, 0),
      }))
      .filter(({ count }) => count > 0)
      .map(({ backend, count }) => `${backend}=${count}`)
      .join("; ");
    const counts = h.stages.map((stage) => {
      const count = cells.filter((cell) => cell.stage === stage).reduce((sum, cell) => sum + cell.count, 0);
      return `<td title="${escapeHtml(summarizeBackends(stage))}">${escapeHtml(count || "")}</td>`;
    }).join("");
    return `<tr><td>${escapeHtml(kind)}</td>${counts}<td>${escapeHtml(summarizeBackends())}</td></tr>`;
  }).join("");
  const { pct, attributed, total } = h.coverage;
  return `<div class="hint">${escapeHtml(`覆盖率 ${pct}%（${attributed}/${total}，unknown 不计）`)}</div>
    <div class="tb-card"><table class="tb-table" data-panel="insights-rollback-heatmap">
      <thead><tr><th>原因</th>${h.stages.map((stage) => `<th>${escapeHtml(stage)}</th>`).join("")}<th>后端</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function renderF07(state: Pick<DashboardState, "f07">): string {
  const f07 = state.f07;
  if (!f07) {
    return `<div class="run empty"><span class="name">暂无 F-07 度量数据</span></div>`;
  }

  const trend = f07.costTrend === "down" ? "下降 ↓" : f07.costTrend === "up" ? "上升 ↑" : "持平 →";
  return `<div class="kpis" data-panel="insights-f07">
    ${renderMetric(`${formatNumber(f07.autoCompletionPct)}%`, "自动完成率", "suc")}
    ${renderMetric(`${formatNumber(f07.rollbackPct)}%`, "回滚率", "wrn")}
    ${renderMetric(formatNumber(f07.openHumanGates), "待批人工门", "pri")}
    ${renderMetric(formatNumber(f07.tokens30d), "近 30 天 token")}
    ${renderMetric(formatNumber(f07.tokensPrev30d), "此前 30 天 token")}
    ${renderMetric(trend, "成本趋势")}
  </div>`;
}

function renderSavings(state: Pick<DashboardState, "savings">): string {
  const savings = state.savings;
  if (!savings) {
    return `<div class="run empty"><span class="name">暂无净省工时数据</span></div>`;
  }

  return `<div class="kpis" data-panel="insights-savings">
    ${renderMetric(`${formatNumber(savings.netSavedHours)} h`, "净省工时", "suc")}
    ${renderMetric(`${formatNumber(savings.humanEstimateHours)} h`, "人工估时")}
    ${renderMetric(`${formatNumber(savings.loopActualHours)} h`, "Loop 实际工时")}
    ${renderMetric(formatNumber(savings.verifiedDevFlows), "已验证开发流", "pri")}
  </div>`;
}

function renderCost(state: Pick<DashboardState, "costSummary">): string {
  const cost = state.costSummary;
  if (!cost) {
    return `<div class="run empty"><span class="name">暂无成本数据</span></div>`;
  }

  const models = Object.entries(cost.tokensByModel ?? {});
  const rows = models.length > 0
    ? models
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([model, tokens]) => `<tr><td>${escapeHtml(model)}</td><td>${escapeHtml(formatNumber(tokens))}</td></tr>`)
        .join("")
    : `<tr><td colspan="2" class="tb-empty">暂无按模型拆分的 token 数据</td></tr>`;

  return `<div class="kpis" data-panel="insights-cost-total">
      ${renderMetric(formatNumber(cost.totalTokens), "累计 token", "pri")}
    </div>
    <div class="tb-card">
      <table class="tb-table" data-panel="insights-cost-models">
        <thead><tr><th>模型</th><th>token</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

export function renderInsights(
  state: Pick<DashboardState, "f07" | "savings" | "costSummary" | "qualityGateStats" | "rollbackHeatmap">,
): string {
  return `<div class="topbar"><span class="crumb">洞察</span><span class="hint">度量 · 省时 · 成本</span></div>
    <div class="body">
      <div class="wrap">
        <div class="section-h"><h3>质量门战绩</h3><span class="hint">Verified · 失败模式 · 回滚</span></div>
        ${renderQualityGates(state)}

        <div class="section-h"><h3>回滚热图（30 天）</h3><span class="hint">原因 × 阶段 × 后端</span></div>
        ${renderRollbackHeatmap(state)}

        <div class="section-h"><h3>度量 F-07</h3><span class="hint">交付健康与人工门</span></div>
        ${renderF07(state)}

        <div class="section-h"><h3>净省工时</h3><span class="hint">仅计 verified 开发流</span></div>
        ${renderSavings(state)}

        <div class="section-h"><h3>成本</h3><span class="hint">累计 token · 按模型</span></div>
        ${renderCost(state)}

        <div class="section-h"><h3>继续下钻</h3><span class="hint">查看系统结构与改进闭环</span></div>
        <div class="actions">
          <a class="b" href="#/architecture">架构拓扑</a>
          <a class="b" href="#/evolution">自进化</a>
        </div>
      </div>
    </div>`;
}
