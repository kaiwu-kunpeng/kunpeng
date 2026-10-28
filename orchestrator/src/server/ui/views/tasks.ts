import { buildTaskBoard } from "../../../cockpit/task-board.js";
import type { TaskBoardFlow, TaskBoardRow } from "../../../cockpit/task-board.js";
import { flowLevel } from "../../../metrics/flow-level.js";
import { fullHarnessCount } from "../../../metrics/harness-locks.js";
import { checkup } from "../../../metrics/paradigm-checkup.js";
import type { AutomationLevel } from "../../../metrics/automation-level.js";
import { flowUsdStageMix } from "../../../runtime/flow-cost.js";
import { escHtml as escapeHtml } from "../../../util/esc-html.js";

interface FlowInput {
  id: string;
  planId?: string;
  requirement?: string;
  stage?: string;
  status?: string;
  project?: { name?: string };
  elapsedMs?: number;
  level?: AutomationLevel;
  history?: { stage: string; at?: number }[];
  tokens?: number;
  tokensUsed?: number;
  updatedAt?: number;
  model?: string;
  stageTokens?: Record<string, number>;
  stageModels?: Record<string, string>;
  stageBackends?: Record<string, string>;
  tokenQuad?: { input?: number; output?: number; cacheCreate?: number; cacheRead?: number };
}

export function estimateCost(tokens: number): number {
  return (tokens / 1_000_000) * 6;
}

function toTaskBoardFlow(flow: FlowInput): TaskBoardFlow {
  const tokens = flow.tokensUsed ?? flow.tokens ?? 0;
  const stageBackendValues = Object.values(flow.stageBackends ?? {});
  const lastStageBackend = stageBackendValues.at(-1);
  const hasStageTokens = Object.values(flow.stageTokens ?? {}).some((value) => Number.isFinite(value) && value > 0);
  const cacheReadTokens = flow.tokenQuad?.cacheRead;

  return {
    id: flow.id,
    requirement: flow.requirement ?? flow.id,
    status: flow.status ?? flow.stage ?? "unknown",
    project: flow.project?.name ?? "—",
    model: lastStageBackend ?? flow.model ?? "—",
    tokens,
    costUsd: hasStageTokens ? flowUsdStageMix(flow) : estimateCost(tokens),
    ...(typeof cacheReadTokens === "number" && Number.isFinite(cacheReadTokens) && cacheReadTokens > 0
      ? { cacheReadTokens }
      : {}),
    level: flow.level ?? flowLevel(flow),
    ageMs: flow.elapsedMs ?? 0,
    updatedAt: flow.updatedAt,
  };
}

function statusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes("verified")) {
    return "tag-ok";
  }
  if (normalized.includes("running")) {
    return "tag-info";
  }
  if (
    normalized.includes("roll") ||
    normalized.includes("crash") ||
    normalized.includes("block") ||
    normalized.includes("fail")
  ) {
    return "tag-danger";
  }
  if (normalized.includes("stop") || normalized.includes("pause")) {
    return "tag-idle";
  }
  return "tag-warn";
}

function lvlClass(level: string): string {
  if (level === "L3") {
    return "lvl-l3";
  }
  if (level === "L2") {
    return "lvl-l2";
  }
  if (level === "L1") {
    return "lvl-l1";
  }
  return "lvl-none";
}

function renderKpi(className: string, value: unknown, label: string): string {
  return `<div class="${className}"><div class="n">${escapeHtml(value)}</div><div class="l">${escapeHtml(label)}</div></div>`;
}

function renderCheckup(rows: TaskBoardRow[]): string {
  const levels = rows.map((r) => r.level).filter((l): l is AutomationLevel => l !== "—");
  const cu = checkup(levels);
  const t = cu.total || 1;
  const p3 = Math.round((cu.distribution.L3 / t) * 100);
  const p2 = Math.round((cu.distribution.L2 / t) * 100);
  const p1 = Math.round((cu.distribution.L1 / t) * 100);
  const ratio = Math.round(cu.l3Ratio * 100);
  return `<div class="tb-checkup">
      <span class="ck-label">范式体检</span>
      <div class="tb-bar"><i class="s-l3" style="width:${p3}%"></i><i class="s-l2" style="width:${p2}%"></i><i class="s-l1" style="width:${p1}%"></i></div>
      <span class="ck-chip ck-l3">L3 ${cu.distribution.L3}</span>
      <span class="ck-chip ck-l2">L2 ${cu.distribution.L2}</span>
      <span class="ck-chip ck-l1">L1 ${cu.distribution.L1}</span>
      <span class="tb-ratio">自主率 ${ratio}%</span>
    </div>`;
}

function renderHarness(flows: FlowInput[]): string {
  const full = fullHarnessCount(flows);

  return `<div class="tb-checkup">
      <span class="ck-label">Harness 护栏</span>
      <span class="tb-ratio">${full}/${flows.length} 流跑满 4 锁</span>
      <span class="hint">隔离 worktree · spec/验收门 · 人审合并门 · 确定性检索</span>
    </div>`;
}

function renderRow(row: TaskBoardRow): string {
  const cacheRead = row.cacheReadTokens !== undefined
    ? ` <span class="cache-read" data-cache-read="${row.cacheReadTokens}">缓存读 ${row.cacheReadTokens.toLocaleString("en-US")}</span>`
    : "";
  const displayCost = `$${Number(row.cost.slice(1)).toFixed(2)}`;
  return `<tr>
      <td><span class="tb-req" title="${escapeHtml(row.rawRequirement)}">${escapeHtml(row.requirement)}</span></td>
      <td><span class="tag ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
      <td><span class="tb-proj">${escapeHtml(row.project)}</span></td>
      <td>${escapeHtml(row.model)}</td>
      <td class="num" title="${escapeHtml(row.rawTokens)}" data-raw-tokens="${escapeHtml(row.rawTokens)}">${escapeHtml(row.tokens)}${cacheRead}</td>
      <td class="num" title="${escapeHtml(row.cost)}">${escapeHtml(displayCost)}</td>
      <td><span class="lvl ${lvlClass(row.level)}">${escapeHtml(row.level)}</span></td>
      <td class="tb-age">${escapeHtml(row.age)}</td>
    </tr>`;
}

export function renderTaskBoardPanel(): string {
  return `<section class="today-panel" data-taskboard>
    <div class="section-h">
      <h3>协作队列</h3>
      <span class="hint">跨实例可认领任务(依赖阻塞/心跳判死自动回收)</span>
      <button class="b" type="button" data-taskboard-reap>回收死主任务</button>
    </div>
    <div class="runs" data-taskboard-message aria-live="polite"></div>
    <div class="runs" data-taskboard-list>
      <div class="run empty"><span class="name">加载中…</span></div>
    </div>
    <form class="runs" data-taskboard-create>
      <div class="run">
        <label class="name">任务 <input name="subject" placeholder="协作任务标题" required></label>
        <button class="b" type="submit">建任务</button>
      </div>
    </form>
  </section>`;
}

export function renderTasks(flows: FlowInput[]): string {
  const board = buildTaskBoard(flows.map(toTaskBoardFlow));
  const rows = board.rows.length > 0
    ? board.rows.map(renderRow).join("")
    : `<tr><td colspan="8" class="tb-empty">暂无运行中的流</td></tr>`;

  return `<section class="today-panel">
    <div class="section-h">
      <h3>今日</h3>
      <span class="hint">待审 / 在跑 / 阻塞 / 24h 交付</span>
      <button class="b" data-action="today-refresh">刷新</button>
    </div>
    <div class="runs" data-today-summary>
      <div class="run empty"><span class="name">加载中…</span></div>
    </div>
    <form class="runs" data-task-create>
      <div class="run">
        <label class="name">标题 <input name="title" placeholder="任务标题"></label>
        <label class="name">类型 <select name="type"><option value="feature" selected>feature</option><option value="fix">fix</option><option value="chore">chore</option></select></label>
      </div>
      <div class="run">
        <label class="name">目标 <input name="goal" placeholder="明确目标"></label>
      </div>
      <div class="run">
        <label class="name">验收 <textarea name="acceptance" placeholder="验收标准，每行一条"></textarea></label>
      </div>
      <div class="run">
        <button class="b" type="submit">创建任务</button>
      </div>
    </form>
  </section>
  <section class="task-board">
    <div class="section-h"><h3>任务台</h3><span class="hint">跨项目运行中的流</span></div>
    <div class="kpis tb-kpis">
      ${renderKpi("kpi pri", board.summary.total, "总流")}
      ${renderKpi("kpi", board.summary.byStatus.running ?? 0, "运行中")}
      ${renderKpi("kpi suc", board.summary.byStatus.verified ?? 0, "已验")}
      ${renderKpi("kpi", board.summary.byLevel.L3 ?? 0, "L3 端到端")}
    </div>
    ${renderCheckup(board.rows)}
    ${renderHarness(flows)}
    <div class="tb-card"><table class="tb-table">
        <thead>
          <tr>
            <th>需求</th>
            <th>状态</th>
            <th>项目</th>
            <th>模型</th>
            <th class="num">tokens</th>
            <th class="num">成本</th>
            <th>等级</th>
            <th>耗时</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table></div>
  </section>
  ${renderTaskBoardPanel()}`;
}
