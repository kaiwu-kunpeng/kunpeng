import type { DossierOverview } from "../../dossier-state.js";
import type { DashboardState } from "../../state.js";
import { estimateCostUsd } from "../../../runtime/cost-pricing.js";
import type { SavingsRollup } from "../../../metrics/time-saved.js";
import { escHtml } from "../../../util/esc-html.js";
import { renderActionInbox } from "./action-inbox.js";
import { clip, fmtTokens, relTime, stripInlineMd, stripMd } from "../fmt.js";

function progressFor(stage: string): number {
  switch (stage) {
    case "spec":
      return 18;
    case "audit":
      return 36;
    case "implement":
      return 62;
    case "verify":
      return 84;
    case "done":
      return 100;
    default:
      return 24;
  }
}

function stageClass(stage: string): string {
  return stage === "verify" || stage === "done" ? "verify" : "impl";
}

function heroCopy(light: DashboardState["systemLight"]): {
  tone: string;
  badge: string;
  title: string;
  sub: string;
} {
  if (light === "red") {
    return {
      tone: "danger",
      badge: "有未解决问题",
      title: "有未解决问题，需要处理",
      sub: "存在崩溃流、活跃卡点或其它未解除风险。",
    };
  }
  if (light === "yellow") {
    return {
      tone: "warn",
      badge: "有告警",
      title: "有告警，建议关注",
      sub: "系统仍在运行，但存在需要跟进的告警信号。",
    };
  }
  return {
    tone: "success",
    badge: "系统正常运行",
    title: "扶摇直上，一切安好",
    sub: "无崩溃流 · 无活跃卡点 · 巡检自愈在岗",
  };
}

function renderKpi(kind: "pri" | "wrn" | "suc" | "neu", value: number, label: string): string {
  return `<div class="kpi ${kind}"><span class="chip" aria-hidden="true"></span><div><div class="n">${value}</div><div class="l">${escHtml(label)}</div></div></div>`;
}

function renderF07Metric(
  kind: "pri" | "wrn" | "suc" | "neu",
  value: string,
  label: string,
  title?: string,
): string {
  const titleAttribute = title ? ` title="${escHtml(title)}"` : "";
  return `<div class="kpi ${kind}"><span class="chip" aria-hidden="true"></span><div><div class="n"${titleAttribute}>${escHtml(value)}</div><div class="l">${escHtml(label)}</div></div></div>`;
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function formatCompactTokens(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  if (value < 1e6) return value.toLocaleString("en-US");
  if (value < 1e9) {
    const millions = (value / 1e6).toFixed(1);
    if (Number(millions) < 1000) return `${millions}M`;
  }
  return `${(value / 1e9).toFixed(1)}B`;
}

export function formatF07TokenTile(tokens30d: number, costTrend: string | undefined): string {
  const tokens = formatCompactTokens(tokens30d);
  const trendMark = costTrend === "down" ? "↓" : costTrend === "up" ? "↑" : "→";
  return `${tokens}\u00a0${trendMark}`;
}

export function f07TokenTileTitle(tokens30d: number): string {
  return Number.isFinite(tokens30d) && tokens30d >= 0 ? tokens30d.toLocaleString("en-US") : "0";
}

export function renderEscapeRateSlot(): string {
  return "<span data-escape-rate-compact>…</span>";
}

function renderF07Dashboard(state: DashboardState): string {
  const f07 = state.f07;
  if (!f07) return "";

  return `
    <div class="section-h">
      <h3>F-07 愿景仪表</h3>
      <span class="hint">自动 · 回滚 · 人工门 · token · 逃逸</span>
    </div>
    <div class="kpis" data-panel="f07">
      ${renderF07Metric("suc", `${formatPct(f07.autoCompletionPct)}%`, "自动完成率")}
      ${renderF07Metric("wrn", `${formatPct(f07.rollbackPct)}%`, "回滚率")}
      ${renderF07Metric("pri", formatCount(f07.openHumanGates), "待批人工门数")}
      ${renderF07Metric(
        "neu",
        formatF07TokenTile(f07.tokens30d, f07.costTrend),
        "30 天 token",
        f07TokenTileTitle(f07.tokens30d),
      )}
      <div class="kpi neu"><span class="chip" aria-hidden="true"></span><div><div class="n">${renderEscapeRateSlot()}</div><div class="l">逃逸率</div></div></div>
    </div>
  `;
}

function renderPreflightBanner(preflight: DashboardState["preflight"]): string {
  const failed = (preflight ?? []).filter((item) => item.ok === false);
  if (failed.length === 0) return "";

  const rows = failed.map((item) => [
    `<div class="run">`,
    `<span class="tag tag-warn">${escHtml(item.label)}</span>`,
    `<span class="name">${escHtml(item.hint)}</span>`,
    `</div>`,
  ].join("")).join("");

  return `
        <div class="preflight-banner runs">
          <div class="run"><span class="tag tag-warn">预检</span><span class="name">${escHtml(`离能干活还差 ${failed.length} 步`)}</span></div>
          ${rows}
        </div>`;
}

function withOverviewDefaults(state: DashboardState): DashboardState {
  const input = state as Partial<DashboardState>;
  const running = input.running ?? [];
  return {
    ...state,
    agents: input.agents ?? 0,
    flows: input.flows ?? [],
    running,
    blockers: input.blockers ?? [],
    humanGates: input.humanGates ?? [],
    artifacts: input.artifacts ?? {},
    branches: input.branches ?? [],
    statusCounts: input.statusCounts ?? {},
    systemLight: input.systemLight ?? "green",
    agentAssignments: input.agentAssignments ?? [],
    patrol: input.patrol ?? { pendingCount: 0, lastRunText: "尚未巡检" },
    plans: input.plans ?? [],
    code: input.code ?? {
      srcLines: 0,
      testLines: 0,
      passedLines: 0,
      inFlightLines: 0,
      completed: 0,
      running: running.length,
      rolledBack: 0,
    },
    designCandidates: input.designCandidates ?? [],
    health: input.health ?? { alerts: [], running: running.length, healthy: running.length },
  };
}

export function selfCardStats(state: DashboardState): {
  srcLines: number;
  testLines: number;
  passedLines: number;
  completed: number;
  plans: number;
  flows: number;
} {
  if (state.self) {
    return {
      srcLines: state.self.srcLines,
      testLines: state.self.testLines,
      passedLines: state.self.passedLines,
      completed: state.self.completed,
      plans: state.self.plansTotal,
      flows: state.self.flowsTotal,
    };
  }
  return {
    srcLines: state.code.srcLines,
    testLines: state.code.testLines,
    passedLines: state.code.passedLines,
    completed: state.code.completed,
    plans: state.plans.length,
    flows: state.flows.length,
  };
}

function displayText(value: string, max: number): string {
  return clip(stripMd(value), max);
}

function renderRunning(state: DashboardState): string {
  if (state.running.length === 0) {
    return `<div class="run empty"><span class="name">暂无在跑流</span></div>`;
  }

  return state.running.map((flow) => {
    const tag = flow.planId || flow.flowId || "current";
    const name = displayText(flow.requirement || flow.flowId, 64);
    const stage = flow.stage;
    const pct = progressFor(stage);
    const projectTag = flow.project
      ? `<span class="tag" style="background:var(--primary-soft);color:var(--primary);border-color:var(--primary-line)">${escHtml(flow.project.name)}</span>`
      : "";

    return [
      `<div class="run" title="${escHtml(flow.flowId)}">`,
      projectTag,
      `<span class="tag">${escHtml(tag)}</span>`,
      `<span class="name">${escHtml(name)}</span>`,
      `<span class="stage ${stageClass(stage)}">${escHtml(stage)}</span>`,
      `<span class="bar"><i style="width:${pct}%"></i></span>`,
      `<span class="pct">${pct}%</span>`,
      `</div>`,
    ].join("");
  }).join("");
}

function renderMainPanel(state: DashboardState): string {
  const main = state.main;
  const content = main
    ? [
      `<div class="run">`,
      `<span class="tag">${escHtml(main.commit)}</span>`,
      `<span class="name">${escHtml(displayText(main.subject, 64))}</span>`,
      `<span class="stage verify">${escHtml(`更新于 ${main.committedText}`)}</span>`,
      `<span class="muted">已合并 ${escHtml(main.mergedPlans)} 方案</span>`,
      `<span class="muted">残留 ${escHtml(main.staleBranches)} 分支</span>`,
      `</div>`,
    ].join("")
    : `<div class="run empty"><span class="name">非 git 仓库或暂无 main 提交</span></div>`;

  return `
    <div class="section-h">
      <h3>主干 main</h3>
      <span class="hint">当前真相</span>
    </div>
    <div class="runs" data-panel="main">
      ${content}
    </div>
  `;
}

function renderCodePanel(state: DashboardState): string {
  const c = state.code;
  return `
    <div class="section-h">
      <h3>全部工作区代码</h3>
      <span class="hint">跨项目求和 · 已过审入 main</span>
    </div>
    <div class="runs" data-panel="code">
      <div class="run">
        <span class="tag">源码 ${escHtml(c.srcLines)} 行</span>
        <span class="tag">测试 ${escHtml(c.testLines)} 行</span>
        <span class="stage verify">共 ${escHtml(c.passedLines)} 行已过审入 main</span>
        <span class="muted">在跑未合 ${escHtml(c.inFlightLines)} 行 · 已交付 ${escHtml(c.completed)} 方案</span>
      </div>
    </div>
  `;
}

function renderActivityFlowRow(flow: {
  flowId: string;
  status: string;
  stage: string;
  updatedAt?: number;
  agoText: string;
  project?: { id: string; name: string };
}): string {
  const projectTag = flow.project ? `<span class="tag">${escHtml(flow.project.name)}</span>` : "";
  const timeText = typeof flow.updatedAt === "number" && Number.isFinite(flow.updatedAt)
    ? relTime(flow.updatedAt)
    : flow.agoText;
  return [
    `<div class="run" data-flow="${escHtml(flow.flowId)}">`,
    `<span class="tag">${escHtml(flow.flowId)}</span>`,
    projectTag,
    `<span class="stage ${stageClass(flow.stage)}">${escHtml(flow.status)}</span>`,
    `<span class="muted">${escHtml(timeText)}</span>`,
    `<button class="pick" data-action="evidence" data-flow="${escHtml(flow.flowId)}">证据</button>`,
    `</div>`,
  ].join("");
}

function renderActivityGroups(state: DashboardState): string | undefined {
  const groups = state.activityByProject;
  if (!groups || groups.length === 0) return undefined;

  return groups.map((group) => {
    const rate = Math.round(group.successRate * 100);
    const recent = group.recent.length === 0
      ? `<div class="run empty"><span class="name">暂无活动</span></div>`
      : group.recent.map((flow) => renderActivityFlowRow(flow)).join("");

    return [
      `<div data-project-group="${escHtml(group.id)}">`,
      `<div class="run">`,
      `<span class="tag">${escHtml(group.name)}</span>`,
      `<span class="stage verify">${escHtml(group.total)} 流 · 成功率 ${escHtml(rate)}%</span>`,
      `<span class="muted">${escHtml(group.verified)} verified · ${escHtml(group.rolledBack)} 回滚</span>`,
      `</div>`,
      recent,
      `</div>`,
    ].join("");
  }).join("");
}

function renderActivityPanel(state: DashboardState): string {
  const activity = state.activity;
  if (!activity) {
    return `
      <div class="section-h">
        <h3>研发活动</h3>
        <span class="hint">历史流</span>
      </div>
      <div class="runs" data-panel="activity">
        <div class="run empty"><span class="name">暂无活动数据</span></div>
      </div>
    `;
  }

  const rate = Math.round(activity.successRate * 100);
  const grouped = renderActivityGroups(state);
  const recent = grouped ?? (activity.recent.length === 0
    ? `<div class="run empty"><span class="name">暂无历史流</span></div>`
    : activity.recent.map((flow) => renderActivityFlowRow(flow)).join(""));

  return `
    <div class="section-h">
      <h3>研发活动</h3>
      <span class="hint">历史流</span>
    </div>
    <div class="runs" data-panel="activity">
      <div class="run">
        <span class="tag">历史 ${escHtml(activity.total)} 流</span>
        <span class="stage verify">成功率 ${escHtml(rate)}%</span>
        <span class="muted">${escHtml(activity.verified)} verified · ${escHtml(activity.rolledBack)} 回滚</span>
      </div>
      ${recent}
    </div>
  `;
}

function renderFailuresPanel(state: DashboardState): string {
  const failures = state.flows
    .filter((flow) => flow.status === "rolled-back")
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6);
  const content = failures.length === 0
    ? `<div class="run empty"><span class="name">暂无失败流 · 一切顺利</span></div>`
    : failures.map((flow) => {
      const reason = displayText(flow.blocker?.trim() || "未记录原因", 120);
      return [
        `<div class="run" data-flow="${escHtml(flow.flowId)}">`,
        `<span class="tag">${escHtml(flow.flowId)}</span>`,
        `<span class="muted">${escHtml(reason)}</span>`,
        `<span class="stage impl">${escHtml(flow.status)}</span>`,
        `<button class="pick" data-action="evidence" data-flow="${escHtml(flow.flowId)}">证据</button>`,
        `</div>`,
      ].join("");
    }).join("");

  return `
    <div class="section-h">
      <h3>失败复盘</h3>
      <span class="hint">回滚流 · 原因 + 证据</span>
    </div>
    <div class="runs" data-panel="failures">
      ${content}
    </div>
  `;
}

function renderReleasePanel(state: DashboardState): string {
  const releases = (state.artifacts.release ?? []).slice(-6);
  const content = releases.length === 0
    ? `<div class="run empty"><span class="name">暂无发布记录</span></div>`
    : releases.map((item) => {
      const summary = displayText(String(item.summary ?? "").trim() || "未记录摘要", 100);
      const statusClass = item.status === "verified" || item.status === "ready" ? "verify" : "impl";
      return [
        `<div class="run">`,
        `<span class="tag">${escHtml(item.id)}</span>`,
        `<span class="muted">${escHtml(summary)}</span>`,
        `<span class="stage ${statusClass}">${escHtml(item.status)}</span>`,
        `</div>`,
      ].join("");
    }).join("");

  return `
    <div class="section-h">
      <h3>发布 / 回滚</h3>
      <span class="hint">发布前验证 · ready / 回滚</span>
    </div>
    <div class="runs" data-panel="release">
      ${content}
    </div>
  `;
}

function renderHealthAlertsPanel(state: DashboardState): string {
  const alerts = state.health.alerts;
  if (alerts.length === 0) return "";

  const content = alerts.map((alert) => {
    const minutes = Math.max(1, Math.round(alert.ageMs / 60000));
    const kind = alert.kind === "stuck" ? "卡住" : "长跑";
    return [
      `<div class="run" data-flow="${escHtml(alert.flowId)}">`,
      `<span class="tag">${escHtml(kind)}</span>`,
      `<span class="name">${escHtml(alert.flowId)}</span>`,
      `<span class="stage impl">${escHtml(alert.stage)}</span>`,
      `<span class="muted">${escHtml(minutes)} 分钟未收敛</span>`,
      `<button class="pick" data-action="abandon-flow" data-flow="${escHtml(alert.flowId)}">中止</button>`,
      `</div>`,
    ].join("");
  }).join("");

  return `
    <div class="section-h">
      <h3>健康告警</h3>
      <span class="hint">卡死 / 长跑 · 可一键中止</span>
    </div>
    <div class="runs" data-panel="health-alerts">
      ${content}
    </div>
  `;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function modelDisplayName(model: string): string {
  switch (model) {
    case "opus":
      return "Claude Opus 4.8";
    case "sonnet":
      return "Claude Sonnet 4.6";
    case "haiku":
      return "Claude Haiku 4.5";
    case "low":
      return "Codex·low";
    case "medium":
      return "Codex·medium";
    case "high":
      return "Codex·high";
    default:
      return model;
  }
}

function modelRank(model: string): number {
  if (model === "low" || model === "medium" || model === "high") return 0;
  if (model === "haiku" || model === "sonnet" || model === "opus") return 1;
  return 2;
}

function categoryLabel(cat: string): string {
  switch (cat) {
    case "research-loop":
      return "研发循环";
    case "comms":
      return "通讯";
    case "governance":
      return "治理";
    case "ops":
      return "运维";
    case "platform":
      return "平台";
    default:
      return cat;
  }
}

function categoryColor(cat: string): string {
  switch (cat) {
    case "research-loop":
      return "var(--ch-ears)";
    case "comms":
      return "var(--ch-official)";
    case "governance":
      return "var(--success)";
    case "ops":
      return "var(--warn)";
    case "platform":
      return "var(--muted)";
    default:
      return "var(--muted)";
  }
}

function lightTagClass(l: string): string {
  switch (l) {
    case "green":
      return "tag-ok";
    case "yellow":
      return "tag-warn";
    case "red":
      return "tag-danger";
    case "idle":
      return "tag-idle";
    default:
      return "tag-idle";
  }
}

function lightDot(l: string): string {
  switch (l) {
    case "green":
      return "●绿";
    case "yellow":
      return "●黄";
    case "red":
      return "●红";
    case "idle":
      return "○闲";
    default:
      return "○";
  }
}

function renderUsagePanel(state: DashboardState): string {
  const cost = state.costSummary;
  const quota = state.quota;
  const hasUsageData = cost !== undefined || quota !== undefined;
  const fmtMs = (ms: number) => ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : Math.round(ms) + "ms";

  const stageEntries = Object.entries(cost?.tokensByStage ?? {});
  const stages = stageEntries.length === 0
    ? ""
    : `<span class="muted">${stageEntries
      .map(([stage, tokens]) => `${escHtml(stage)} ${escHtml(fmtTokens(tokens))}`)
      .join(" ｜ ")}</span>`;
  const totalTokensRaw = formatCount(cost?.totalTokens ?? 0);

  const modelCalls = new Map<string, number>();
  for (const account of quota?.accounts ?? []) {
    for (const model of account.models) {
      modelCalls.set(model.model, (modelCalls.get(model.model) ?? 0) + model.calls);
    }
  }
  const models = modelCalls.size === 0
    ? ""
    : `<span class="muted">模型 ${Array.from(modelCalls.entries())
      .sort((a, b) => modelRank(a[0]) - modelRank(b[0]) || a[0].localeCompare(b[0]))
      .map(([model, calls]) => `${escHtml(modelDisplayName(model))} ${escHtml(formatCount(calls))} 次`)
      .join(" · ")}</span>`;

  const modelTokenEntries = Object.entries(cost?.tokensByModel ?? {});
  const modelTokenRaw = modelTokenEntries
    .sort((a, b) => modelRank(a[0]) - modelRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([model, tokens]) => `${modelDisplayName(model)} ${formatCount(tokens)} token`)
    .join(" · ");
  const modelTokens = modelTokenEntries.length === 0
    ? ""
    : `<span class="muted" title="${escHtml(modelTokenRaw)}">按模型 ${modelTokenEntries
      .sort((a, b) => modelRank(a[0]) - modelRank(b[0]) || a[0].localeCompare(b[0]))
      .map(([model, tokens]) => `${escHtml(modelDisplayName(model))} ${escHtml(fmtTokens(tokens))} token`)
      .join(" · ")}</span>`;
  const bottleneckEntries = (cost?.stageBottlenecks ?? []).filter((b) => (b.ms ?? 0) > 0);
  const bottlenecks = bottleneckEntries.length === 0
    ? ""
    : `<span class="muted">瓶颈(耗时) ${bottleneckEntries
      .map((b) => escHtml(b.label) + " " + escHtml(fmtMs(b.ms ?? 0)))
      .join(" · ")}</span>`;

  const usd = estimateCostUsd(cost?.tokensByModel ?? {}).totalUsd;
  const costDetails = cost
    ? [
      `<span class="tag">确定性 ${escHtml(Math.round((cost.determinismRatio ?? 0) * 100))}%</span>`,
      `<span class="tag">省下 LLM 调用 ${escHtml(formatCount(cost.savedLlmCalls ?? 0))} 次</span>`,
      `<span class="tag">≈ $${escHtml(usd.toFixed(2))} 估算(按 API 价)</span>`,
    ]
    : [];
  const quotaWarnings = (quota?.accounts ?? [])
    .filter((acc) => acc.limit !== undefined && acc.used >= acc.limit)
    .map((acc) => `<span class="tag tag-danger">账号 ${escHtml(acc.id)} 已达限额 ${escHtml(formatCount(acc.used))}/${escHtml(formatCount(acc.limit ?? 0))}</span>`);

  const content = !hasUsageData
    ? `<div class="run empty"><span class="name">暂无用量数据</span></div>`
    : [
      `<div class="run">`,
      `<span class="tag" title="${escHtml(totalTokensRaw)}">token 消耗：${escHtml(fmtTokens(cost?.totalTokens ?? 0))}</span>`,
      `<span class="tag">对话：${escHtml(formatCount(cost?.llmStages ?? 0))} 次</span>`,
      stages,
      models,
      modelTokens,
      bottlenecks,
      ...costDetails,
      ...quotaWarnings,
      `</div>`,
    ].join("");

  return `
    <div class="section-h">
      <h3>用量</h3>
      <span class="hint">token · 对话 · 模型</span>
    </div>
    <div class="runs" data-panel="usage">
      ${content}
    </div>
  `;
}

function renderCostByProjectPanel(state: DashboardState): string {
  const list = state.costByProject;
  if (!list || list.length === 0) return "";
  return `
    <div class="section-h">
      <h3>各项目用量</h3>
      <span class="hint">token · 按项目</span>
    </div>
    <div class="runs" data-panel="cost-by-project">
      ${list.map((project) => [
        `<div class="run">`,
        `<span class="tag">${escHtml(project.name)}</span>`,
        `<span class="name" title="token ${escHtml(formatCount(project.totalTokens))}">token ${escHtml(fmtTokens(project.totalTokens))}</span>`,
        `<span class="muted">对话 ${escHtml(formatCount(project.llmStages))} 次 · 确定性 ${escHtml(Math.round(project.determinismRatio * 100))}%</span>`,
        `</div>`,
      ].join("")).join("")}
    </div>
  `;
}

function renderModuleStatusPanel(state: DashboardState): string {
  const report = state.moduleStatus;
  if (!report) {
    return `
    <div class="section-h">
      <h3>模块运行状态</h3>
      <span class="hint">按功能区 · 健康灯</span>
    </div>
    <div class="runs" data-panel="modules">
      <div class="run empty"><span class="name">暂无模块数据</span></div>
    </div>
  `;
  }

  const categories = ["research-loop", "comms", "governance", "ops", "platform"];
  const moduleRows = categories.map((cat) => {
    const modules = report.modules.filter((m) => m.category === cat);
    if (modules.length === 0) return "";

    const rows = modules.map((m) => [
      `<div class="run" style="border-left:3px solid ${categoryColor(cat)};padding-left:8px">`,
      `<span class="tag ${lightTagClass(m.light)}">${escHtml(lightDot(m.light))}</span>`,
      `<span class="name">${escHtml(m.name)}</span>`,
      m.lastActivity ? `<span class="muted">${escHtml(m.lastActivity.agoText)}</span>` : "",
      m.heartbeat ? `<span class="muted">${escHtml(m.heartbeat.detail)}</span>` : "",
      m.wired ? "" : `<span class="muted">未接线</span>`,
      `</div>`,
    ].join("")).join("");

    return [
      `<div class="run"><span class="muted">${escHtml(categoryLabel(cat))}</span></div>`,
      rows,
    ].join("");
  }).join("");

  return `
    <div class="section-h">
      <h3>模块运行状态</h3>
      <span class="hint">按功能区 · 健康灯</span>
    </div>
    <div class="runs" data-panel="modules">
      <div class="run"><span class="tag tag-ok">绿 ${escHtml(report.rollup.green)}</span><span class="tag tag-warn">黄 ${escHtml(report.rollup.yellow)}</span><span class="tag tag-danger">红 ${escHtml(report.rollup.red)}</span><span class="tag tag-idle">闲 ${escHtml(report.rollup.idle)}</span></div>
      ${moduleRows}
    </div>
  `;
}

export function renderMetricsPanel(state: DashboardState): string {
  const auto = state.autoCompletion;
  if (!auto) return "";

  const token = state.tokenTrend;
  const gate = state.gateConservation;
  const rate = `${Math.round(auto.rate * 100)}%`;
  const target = `${Math.round(auto.target * 100)}%`;
  const targetClass = auto.meetsTarget ? "verify" : "impl";
  const targetTag = auto.meetsTarget ? "tag-ok" : "tag-danger";
  const trendMark = token?.trend === "up" ? "↑" : token?.trend === "flat" ? "→" : "↓";
  const tokenRow = token
    ? `<div class="run"><span class="tag">token ${escHtml(trendMark)}</span><span class="name">recentAvg ${escHtml(fmtTokens(token.recentAvg))}</span><span class="muted">olderAvg ${escHtml(fmtTokens(token.olderAvg))} · 样本 ${escHtml(token.samples)}</span></div>`
    : "";
  const gateRow = gate
    ? gate.ok
      ? `<div class="run"><span class="stage verify">✓ ${escHtml(gate.allowed.length)} 门守恒</span><span class="muted">${gate.allowed.map((item) => escHtml(item)).join(" · ")}</span></div>`
      : `<div class="run"><span class="stage impl">${escHtml(gate.violations.length)} 条越界</span><span class="muted">${gate.violations.slice(0, 3).map((item) => escHtml(item)).join(" · ")}</span></div>`
    : "";
  const lag = state.eventLoopLag;
  const lagRow = lag
    ? `<div class="run"><span class="tag">事件循环</span><span class="name">p99 ${escHtml(lag.p99Ms)}ms</span><span class="muted">mean ${escHtml(lag.meanMs)}ms · max ${escHtml(lag.maxMs)}ms</span></div>`
    : "";

  return `
    <div class="section-h">
      <h3>F-07 度量</h3>
      <span class="hint">自动完成 · token · 门守恒</span>
    </div>
    <div class="runs" data-panel="metrics">
      <div class="run">
        <span class="tag">自动完成 ${escHtml(rate)}</span>
        <span class="tag ${targetTag}">目标 ${escHtml(target)}</span>
        <span class="stage ${targetClass}">${auto.meetsTarget ? "达标" : "未达标"}</span>
        <span class="muted">尝试 ${escHtml(auto.attempted)} · 自动 ${escHtml(auto.autoCompleted)} · 人工 ${escHtml(auto.neededIntervention)}</span>
      </div>
      ${tokenRow}
      ${gateRow}
      ${lagRow}
    </div>
  `;
}

export function renderEvolutionPanel(state: DashboardState): string {
  const evolution = state.evolution;
  if (!evolution) return "";
  if (evolution.pendingCount === 0 && evolution.approvedCount === 0 && evolution.proposals.length === 0) return "";

  const proposals = evolution.proposals.slice(0, 3);
  const proposalRows = proposals.length === 0
    ? `<div class="run empty"><span class="name">暂无待展示提案</span></div>`
    : proposals.map((proposal) => [
      `<div class="run">`,
      `<span class="tag">${escHtml(proposal.status)}</span>`,
      `<span class="name">${escHtml(displayText(proposal.summary, 80))}</span>`,
      proposal.hasEvidence ? `<span class="stage verify">有证据</span>` : `<span class="stage impl">待证据</span>`,
      `</div>`,
    ].join("")).join("");

  return `
    <div class="section-h">
      <h3>自进化事实</h3>
      <span class="hint">${escHtml(evolution.lastRunText)}</span>
    </div>
    <div class="runs" data-panel="evolution-facts">
      <div class="run">
        <span class="tag">待审 ${escHtml(evolution.pendingCount)}</span>
        <span class="stage verify">已批 ${escHtml(evolution.approvedCount)}</span>
        <span class="muted">${escHtml(evolution.lastRunText)}</span>
      </div>
      ${proposalRows}
    </div>
  `;
}

export function renderLoopHealthPanel(state: DashboardState): string {
  const loops = state.loops;
  if (!loops || loops.length === 0) return "";

  return `
    <div class="section-h">
      <h3>运营 loop 健康</h3>
      <span class="hint">指标 · 波次 · 下一杠杆</span>
    </div>
    <div class="runs" data-panel="loop-health">
      ${loops.map((loop) => [
        `<div class="run">`,
        `<span class="tag">${escHtml(loop.name)}</span>`,
        `<span class="name">${escHtml(loop.metric.label)} ${escHtml(loop.metric.current)}</span>`,
        `<span class="stage verify">${escHtml(loop.waveCount)} 波</span>`,
        loop.nextLever ? `<span class="muted">下一杠杆 ${escHtml(loop.nextLever.label)}</span>` : "",
        `</div>`,
      ].join("")).join("")}
    </div>
  `;
}

export function renderStrategyPanel(d: DossierOverview | undefined, savings?: SavingsRollup): string {
  if (!d || (!d.project.northStar && !d.project.roadmap.now && !d.project.goals)) {
    return `
      <div class="section-h"><h3>战略 · 方案 vs 进度</h3><span class="hint">跑 kunpeng dossier 生成 PROJECT.md</span></div>
      <div class="runs"><div class="run empty"><span class="name">未生成项目档案（PROJECT.md）</span></div></div>`;
  }

  const ns = d.ostNorthStar?.outcome ? `${d.project.northStar || d.ostNorthStar.outcome}` : d.project.northStar;
  const road = (label: string, v: string) =>
    `<div class="kcard" style="flex:1;min-width:180px"><div class="l" style="font-size:11px;color:var(--muted);font-weight:700">${escHtml(label)}</div><div style="font-size:13px;margin-top:4px">${v ? escHtml(stripInlineMd(v)) : "<span style='color:var(--muted)'>—</span>"}</div></div>`;

  return `
    <div class="section-h"><h3>战略 · 方案 vs 进度</h3><span class="hint">来自 PROJECT.md</span></div>
    <div class="card" style="padding:16px 18px">
      ${ns ? `<div style="font-size:14px"><b style="color:var(--kp)">北极星</b> ${escHtml(ns)}</div>` : ""}
      ${savings ? `<div style="font-size:13px;margin-top:6px"><b style="color:var(--kp)">净省工时</b> ${savings.netSavedHours}h（${savings.verifiedDevFlows} 个 verified 工程流；数据运营 ${savings.dataOpsFlows} 不计）</div>` : ""}
      ${d.project.goals ? `<div style="font-size:13px;margin-top:8px;color:var(--ink2)"><b>当期目标</b> ${escHtml(stripInlineMd(d.project.goals))}</div>` : ""}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        ${road("NOW", d.project.roadmap.now)}
        ${road("NEXT", d.project.roadmap.next)}
        ${road("LATER", d.project.roadmap.later)}
      </div>
    </div>`;
}

export function renderDossierPanel(d: DossierOverview | undefined): string {
  if (!d) return "";
  const hasAny = d.changelog.total > 0 || d.adrs.length > 0 || d.specFamilies.length > 0;
  if (!hasAny) return "";

  const changelog = d.changelog.total === 0 ? "" :
    `<div class="kcard" style="flex:1;min-width:220px"><div class="l" style="font-weight:700;font-size:12px">近期变更（未发布 ${escHtml(d.changelog.total)}）</div>` +
    d.changelog.categories.map((c) =>
      `<div style="font-size:12.5px;margin-top:6px"><b>${escHtml(c.name)}</b>${c.items.slice(0, 4).map((i) => `<div style="color:var(--ink2);margin-left:8px">· ${escHtml(i)}</div>`).join("")}</div>`).join("") + `</div>`;
  const adrs = d.adrs.length === 0 ? "" :
    `<div class="kcard" style="flex:1;min-width:200px"><div class="l" style="font-weight:700;font-size:12px">近期决策（ADR）</div>` +
    d.adrs.map((a) => `<div style="font-size:12.5px;margin-top:6px">ADR-${escHtml(a.num)} ${escHtml(a.title)}${a.status ? ` <span style="color:var(--muted)">· ${escHtml(a.status)}</span>` : ""}</div>`).join("") + `</div>`;
  const fams = d.specFamilies.length === 0 ? "" :
    `<div class="kcard" style="flex:1;min-width:200px"><div class="l" style="font-weight:700;font-size:12px">活跃特性族（共 ${escHtml(d.specTotal)} spec）</div>` +
    d.specFamilies.map((f) => `<div style="font-size:12.5px;margin-top:6px">${escHtml(f.family)} <span style="color:var(--muted)">×${escHtml(f.count)}</span></div>`).join("") + `</div>`;

  return `
    <div class="section-h"><h3>变更 · 决策 · 特性</h3><span class="hint">档案层</span></div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">${changelog}${adrs}${fams}</div>`;
}

type RecentAgent = { instance: string; projectId?: string; worktree?: string; task?: string; ts: number };

type RecentAgentSummary = {
  projectId: string;
  count: number;
  lastAgeMs: number;
  shown: Array<{ instance: string; task?: string; worktree?: string; ageMs: number }>;
  hiddenCount: number;
};

export function formatHeartbeatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 60_000) return "刚刚";
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)} 分钟前`;
  return `${Math.floor(ageMs / 3_600_000)} 小时前`;
}

export function summarizeRecentAgents(
  agents: RecentAgent[],
  nowMs: number,
  maxPerProject = 5,
): RecentAgentSummary[] {
  const groups = new Map<string, RecentAgent[]>();
  for (const agent of agents) {
    const projectId = agent.projectId?.trim() || "未归属项目";
    const group = groups.get(projectId) ?? [];
    group.push(agent);
    groups.set(projectId, group);
  }

  const ageOf = (ts: number): number => {
    if (!Number.isFinite(nowMs)) return 0;
    const ageMs = nowMs - ts;
    return Number.isFinite(ageMs) ? Math.max(0, ageMs) : 0;
  };
  const limit = Number.isFinite(maxPerProject) ? Math.max(0, Math.floor(maxPerProject)) : 5;

  return Array.from(groups, ([projectId, group]) => {
    const ordered = [...group].sort((a, b) => b.ts - a.ts);
    const shown = ordered.slice(0, limit).map((agent) => ({
      instance: agent.instance,
      ...(agent.task !== undefined && { task: agent.task }),
      ...(agent.worktree !== undefined && { worktree: agent.worktree }),
      ageMs: ageOf(agent.ts),
    }));
    return {
      projectId,
      count: ordered.length,
      lastAgeMs: ageOf(ordered[0]!.ts),
      shown,
      hiddenCount: ordered.length - shown.length,
    };
  }).sort((a, b) => a.lastAgeMs - b.lastAgeMs || (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0));
}

export function renderAgentsPresentPanel(agents: RecentAgent[], nowMs: number): string {
  const summaries = summarizeRecentAgents(agents, nowMs);
  const rows = summaries.length === 0
    ? `<div class="run empty"><span class="name">最近 30 分钟无 agent 活动</span></div>`
    : summaries.map((summary) => [
      `<div class="run"><span class="tag">${escHtml(summary.projectId)}</span><span class="muted">${escHtml(summary.count)} 次登记 · 最后 ${formatHeartbeatAge(summary.lastAgeMs)}</span></div>`,
      ...summary.shown.map((agent) => [
        `<div class="run">`,
        `<span class="tag">${escHtml(agent.instance)}</span>`,
        agent.task ? `<span class="name">${escHtml(agent.task)}</span>` : `<span class="name">未登记任务</span>`,
        agent.worktree ? `<span class="muted">${escHtml(agent.worktree)}</span>` : "",
        `<span class="muted">${formatHeartbeatAge(agent.ageMs)}</span>`,
        `</div>`,
      ].join("")),
      summary.hiddenCount > 0 ? `<div class="run"><span class="muted">…另 ${escHtml(summary.hiddenCount)} 条</span></div>` : "",
    ].join("")).join("");

  return `
    <div class="section-h">
      <h3>最近活跃 Agent</h3>
      <span class="hint">presence · 最近 30 分钟 · 一次性登记,非并发数</span>
    </div>
    <div class="runs" data-panel="agents-present">
      ${rows}
    </div>
  `;
}

export function renderOverview(state: DashboardState): string {
  const preflightBanner = renderPreflightBanner(state.preflight);
  const overviewState = withOverviewDefaults(state);
  const hero = heroCopy(overviewState.systemLight);
  const alerts = overviewState.health.alerts.length;
  const st = selfCardStats(overviewState);

  return `
    <div class="body">
      <div class="wrap">${preflightBanner}
        <div class="hero ${hero.tone}">
          <div class="hero-text">
            <span class="hero-badge ${hero.tone}"><span class="pdot"></span> ${escHtml(hero.badge)}</span>
            <h2>${escHtml(hero.title)}</h2>
            <div class="poem">鲲化为鹏 · 抟扶摇而上者九万里</div>
            <div class="sub">${escHtml(hero.sub)}</div>
          </div>
        </div>

        ${renderF07Dashboard(overviewState)}

        ${renderActionInbox({
          humanGates: overviewState.humanGates,
          opsGates: overviewState.opsGates,
          failures: overviewState.flows
            .filter((f) => f.status === "crashed")
            .map((f) => ({
              flowId: f.flowId,
              requirement: f.requirement,
              reason: f.blocker,
              project: f.project?.id,
            })),
          blockers: overviewState.blockers.map((b) => ({
            flowId: b.flowId,
            stage: b.stage,
            reason: b.reason,
            project: overviewState.flows.find((fl) => fl.flowId === b.flowId)?.project?.id,
          })),
          runningCount: overviewState.running.length,
          projectFlows: overviewState.flows.map((f) => ({ project: f.project?.name ?? "—", status: f.status })),
        })}

        ${renderStrategyPanel(overviewState.dossier, overviewState.savings)}

        <div class="kpis">
          ${renderKpi("pri", overviewState.running.length, "在跑流")}
          ${renderKpi("wrn", overviewState.humanGates.length, "待我处理")}
          ${renderKpi("neu", st.passedLines, "代码行数(已过审)")}
          ${renderKpi("suc", st.completed, "累计已交付")}
          ${renderKpi("neu", alerts, "卡死 / 长跑告警")}
        </div>
        <div class="overview-stats" style="color:var(--muted);font-size:12.5px;margin:12px 2px 0">鲲鹏本体 ${st.srcLines + st.testLines} 行代码（源码 ${st.srcLines} · 测试 ${st.testLines}）· 累计 ${st.plans} 方案 · ${st.flows} 流 · ${st.completed} 已交付</div>

        ${renderHealthAlertsPanel(overviewState)}

        <div class="section-h">
          <h3>缺陷逃逸率</h3>
          <span class="hint">合并后被回滚/还原占比 · 量化合并门拦截力</span>
        </div>
        <div data-escape-rate class="er-panel" style="color:var(--muted);font-size:13px;padding:4px 2px">逃逸率加载中…</div>

        <div class="section-h">
          <h3>活动</h3>
          <!-- 兼容旧视图路由判别：在跑什么 -->
          <span class="hint">跨项目 · 只读</span>
          <span class="more">全部</span>
        </div>
        <div class="runs">
          ${renderRunning(overviewState)}
          <div class="run" data-activity-drill>
            <a class="pick" href="#/tasks">任务台</a>
            <a class="pick" href="#/terminal">终端</a>
            <span class="muted" data-live-sessions></span>
          </div>
        </div>
        ${renderAgentsPresentPanel(overviewState.agentsPresent ?? [], Date.now())}
        <details class="more-metrics">
          <summary>📊 运维指标与历史 · 点开看 用量/各项目成本/模块状态/F-07度量/自进化/运营loop/研发活动/失败复盘/发布</summary>
          ${renderMainPanel(overviewState)}
          ${renderCodePanel(overviewState)}
          ${renderUsagePanel(overviewState)}
          ${renderCostByProjectPanel(overviewState)}
          ${renderModuleStatusPanel(overviewState)}
          ${renderMetricsPanel(overviewState)}
          ${renderEvolutionPanel(overviewState)}
          ${renderLoopHealthPanel(overviewState)}
          ${renderActivityPanel(overviewState)}
          ${renderDossierPanel(overviewState.dossier)}
          ${renderFailuresPanel(overviewState)}
          ${renderReleasePanel(overviewState)}
        </details>
      </div>
    </div>
  `;
}
