import type { DashboardState, LoopView } from "../../state.js";
import type { Lever } from "../../../loop/types.js";
import { cadenceMs, diffOpsGotchas } from "../../../loop/ops-run.js";
import { loopOpsMetrics, recurringGotchas } from "../../../loop/ops-metrics.js";
import { goalProgress } from "../../../loop/action-ledger.js";
import { escHtml } from "../../../util/esc-html.js";
import { renderUsageGuide } from "../guide.js";

const UNASSIGNED_PROJECT_ID = "未归属";

export interface ProjectLoopGroup<T extends { projectId?: string }> {
  projectId: string;
  items: T[];
}

function normalizeProjectId(projectId?: string): string {
  return projectId === undefined || projectId === "" ? UNASSIGNED_PROJECT_ID : projectId;
}

export function groupByProject<T extends { projectId?: string }>(items: T[]): ProjectLoopGroup<T>[] {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const projectId = normalizeProjectId(item.projectId);
    const group = groups.get(projectId);
    if (group) {
      group.push(item);
    } else {
      groups.set(projectId, [item]);
    }
  }

  return Array.from(groups, ([projectId, groupItems]) => ({ projectId, items: groupItems }))
    .sort((a, b) => {
      const countDiff = b.items.length - a.items.length;
      if (countDiff !== 0) return countDiff;
      if (a.projectId < b.projectId) return -1;
      if (a.projectId > b.projectId) return 1;
      return 0;
    });
}

function renderTrend(loop: LoopView): string {
  const recent = loop.recent ?? [];
  if (recent.length === 0) {
    return `<span class="loop-trend-empty">暂无走势</span>`;
  }

  return recent
    .slice()
    .reverse()
    .map((wave) => `<span class="loop-trend-point">${escHtml(wave.metricAfter)}</span>`)
    .join("");
}

function formatLoopUsageTokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

function renderLoopUsage(state: DashboardState): string {
  const entries = Object.entries(state.costSummary?.tokensByModel ?? {});
  if (entries.length === 0) return "";
  const text = entries
    .map(([model, tokens]) => `${escHtml(model)} ${escHtml(formatLoopUsageTokens(tokens))}`)
    .join(" · ");
  return `<span class="loop-usage">${text}</span>`;
}

function renderGoal(loop: LoopView): string {
  const goal = (loop as LoopView & {
    goal?: { target: number; direction?: "up" | "down" };
  }).goal;
  if (goal === undefined) return "";

  const current = Number(loop.metric.current);
  const pct = Math.round(goalProgress(current, goal) * 100);
  return `<div class="loop-goal muted">${escHtml(`目标 ${goal.target} · 当前 ${loop.metric.current} · 达成 ${pct}%`)}</div>`;
}

function renderOpsTimeline(): string {
  return `
    <div class="section-h">
      <h3>动作时间线</h3>
      <span class="hint">每一波动作与指标变化,来自动作台账</span>
    </div>
    <div class="runs loop-panel" data-ops-timeline></div>
  `;
}

function lastRunByLoop(loops: NonNullable<DashboardState["loops"]>): Map<string, number> {
  const lastRuns = new Map<string, number>();

  for (const loop of loops) {
    if (!loop?.id) continue;
    for (const wave of loop.waves ?? []) {
      const at = wave.at;
      if (!Number.isFinite(at)) continue;
      const prev = lastRuns.get(loop.id);
      if (prev === undefined || at > prev) {
        lastRuns.set(loop.id, at);
      }
    }
  }

  return lastRuns;
}

function renderOpsOverview(state: DashboardState): string {
  const now = Date.now();
  const loops = state.loops ?? [];
  const playbooks = state.playbooks ?? [];
  const gates = state.opsGates ?? [];
  const lastRuns = lastRunByLoop(loops);
  const duePlaybooks = playbooks.filter((playbook) => {
    if (!playbook.loopId) return false;
    const lastRun = lastRuns.get(playbook.loopId);
    return lastRun === undefined || now - lastRun >= cadenceMs(playbook.cadence);
  }).length;
  const pendingGates = gates.filter((gate) => gate.status === "pending").length;
  const stalledLoops = loops.filter((loop) => loopOpsMetrics(loop.waves ?? [], now).stalled).length;
  const recurringGotchaCount = loops.reduce(
    (sum, loop) => sum + recurringGotchas(loop.waves ?? []).length,
    0,
  );
  const stalledLoopLabel = escHtml(`停滞 loop ${stalledLoops}`);

  return `
    <div class="ops-overview">
      <div class="section-h">
        <h3>运营总览</h3>
        <span class="hint">overview</span>
      </div>
      <div class="runs loop-panel" data-panel="ops-overview">
        <div class="run">
          <span class="tag">${escHtml(`到期该跑 ${duePlaybooks}`)}</span>
          <span class="tag${pendingGates > 0 ? " tag-warn" : ""}">${escHtml(`待裁决门 ${pendingGates}`)}</span>
          <span class="tag${stalledLoops > 0 ? " tag-warn" : ""}">${stalledLoopLabel}</span>
          <span class="tag">${escHtml(`顽固卡点 ${recurringGotchaCount}`)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderJudgment(loop: LoopView): string {
  return `
      <div class="loop-judgment">
        <div class="section-h">
          <h3>态势研判</h3>
          <span class="hint">summary</span>
          <button class="b pri" data-action="loop-run" data-loop-id="${escHtml(loop.id)}" data-project-id="${escHtml(loop.projectId ?? "")}">▶ 跑下一轮</button>
        </div>
        ${loop.summary ? `<div class="loop-judgment-line">${escHtml(loop.summary.trend)}</div>
        <div class="loop-judgment-line">${escHtml(loop.summary.recent)}</div>
        <div class="loop-judgment-line">${escHtml(loop.summary.blockers)}</div>
        <div class="loop-judgment-line">${escHtml(loop.summary.next)}</div>` : `<div class="loop-judgment-line">（暂无研判）</div>`}
      </div>
  `;
}

export function renderWeakPointsButton(loopId: string, projectId?: string): string {
  return `
      <div class="section-h">
        <h3>动作建议</h3>
        <span class="hint">机会雷达</span>
        <button class="b" data-action="loop-weakpoints" data-loop="${escHtml(loopId)}" data-project-id="${escHtml(projectId ?? "")}">刷新建议</button>
      </div>
      <div class="runs" data-loop-weakpoints="${escHtml(loopId)}">
        <div class="run empty"><span class="name">点击刷新建议</span></div>
      </div>
  `;
}

function renderWaveRows(loop: LoopView): string {
  const recent = loop.recent ?? [];
  if (recent.length === 0) {
    return `<div class="loop-wave empty"><span class="name">暂无 wave</span></div>`;
  }

  return recent.map((wave) => {
    const deploy = wave.deploy ? wave.deploy : "未部署";
    const verifyClass = wave.verified ? "verify" : "impl";
    const verifyText = wave.verified ? "已验证" : "待验证";
    return `
      <div class="loop-wave" data-wave="${escHtml(wave.seq)}">
        <span class="tag">${escHtml(`#${wave.seq}`)}</span>
        <span class="name">${escHtml(wave.lever)}</span>
        <span class="loop-subject">${escHtml(wave.subject)}</span>
        <span class="stage impl">${escHtml(`Δ ${wave.metricDelta}`)}</span>
        <span class="tag">${escHtml(`after ${wave.metricAfter}`)}</span>
        <span class="muted">${escHtml(deploy)}</span>
        <span class="stage ${verifyClass}">${escHtml(verifyText)}</span>
        ${wave.evidenceKind ? `<span class="tag${wave.evidenceKind === "llm-self-report" ? " tag-warn" : ""}">证据·${escHtml(wave.evidenceKind)}</span>` : ""}
        <span class="muted">${escHtml(wave.agoText)}</span>
      </div>
    `;
  }).join("");
}

function waveGotchas(wave: NonNullable<LoopView["waves"]>[number] | undefined): string[] {
  return wave?.gotchas ?? [];
}

function renderOpsGotchaDiff(loop: LoopView): string {
  const waves = loop.waves ?? [];
  if (waves.length < 2) return "";

  const prev = waveGotchas(waves[waves.length - 2]);
  const next = waveGotchas(waves[waves.length - 1]);
  const diff = diffOpsGotchas(prev, next);
  if (diff.added.length === 0 && diff.resolved.length === 0 && diff.persisted.length === 0) {
    return "";
  }

  return `
        <div class="ops-diff">
          <span class="tag tag-ok">${escHtml(`新增 ${diff.added.length}`)}</span>
          <span class="tag tag-warn">${escHtml(`已解决 ${diff.resolved.length}`)}</span>
          <span class="tag">${escHtml(`仍在 ${diff.persisted.length}`)}</span>
        </div>
      `;
}

function renderOpsMetrics(waves: NonNullable<LoopView["waves"]>, now: number): string {
  const metrics = loopOpsMetrics(waves, now);
  const tags: string[] = [];

  if (waves.length > 0) {
    tags.push(`<span class="tag">${escHtml(`30天 ${metrics.waves30d} 波`)}</span>`);
    tags.push(`<span class="tag">${escHtml(`验证率 ${Math.round(metrics.verifiedRate30d * 100)}%`)}</span>`);
    if (metrics.metricDelta30d !== 0) {
      const delta = metrics.metricDelta30d > 0 ? `+${metrics.metricDelta30d}` : String(metrics.metricDelta30d);
      tags.push(`<span class="tag">${escHtml(`指标 ${delta}`)}</span>`);
    }
  }

  if (metrics.stalled) {
    tags.push(`<span class="tag tag-warn">停滞&gt;14天</span>`);
  }

  return `<div class="loop-wave" data-ops-metrics="ops-metrics">${tags.join("")}</div>`;
}

function renderRecurringGotchas(waves: NonNullable<LoopView["waves"]>): string {
  const gotchas = recurringGotchas(waves);
  if (gotchas.length === 0) return "";

  return `
        <div class="loop-wave" data-ops-recurring="ops-recurring">
          ${gotchas.map((gotcha) => `<span class="tag tag-warn">顽固×${escHtml(gotcha.count)} ${escHtml(gotcha.gotcha).slice(0, 80)}</span>`).join("")}
        </div>
      `;
}

const PHASE_LANES: Array<{ key: string; label: string }> = [
  { key: "research", label: "调研" },
  { key: "create", label: "生产" },
  { key: "distribute", label: "分发" },
  { key: "measure", label: "度量" },
  { key: "evolve", label: "复盘" },
];

function renderPlaybookCard(playbook: NonNullable<DashboardState["playbooks"]>[number]): string {
  const gate = playbook.gate === "auto" ? "自动" : "需复核";
  const goal = playbook.conversionGoal ? playbook.conversionGoal.label : "未设转化目标";
  const meta = [
    playbook.projectId ? `project ${playbook.projectId}` : "",
    playbook.loopId ? `loop ${playbook.loopId}` : "",
    playbook.recipe ? `recipe ${playbook.recipe}` : "",
    playbook.cadence ? `cadence ${playbook.cadence}` : "",
  ].filter(Boolean).join(" · ");
  return `
        <div class="run playbook-card" data-playbook="${escHtml(playbook.id)}">
          <span class="stage">${escHtml(gate)}</span>
          <span class="name">${escHtml(playbook.title)}</span>
          <span class="tag">${escHtml(playbook.id)}</span>
          <span class="hint">${escHtml(goal)}</span>
          ${meta ? `<span class="muted">${escHtml(meta)}</span>` : ""}
        </div>
      `;
}

function renderPlaybookLane(key: string, label: string, playbooks: NonNullable<DashboardState["playbooks"]>): string {
  const rows = playbooks.length
    ? playbooks.map(renderPlaybookCard).join("")
    : `<div class="loop-lever empty"><span class="name">暂无</span></div>`;
  return `
        <div class="loop-lever-col" data-phase="${escHtml(key)}">
          <div class="loop-lever-title">${escHtml(label)}</div>
          ${rows}
        </div>
      `;
}

function renderPlaybooks(state: DashboardState): string {
  const playbooks = state.playbooks ?? [];
  const rows = playbooks.length
    ? `<div class="loop-levers playbook-lanes">
        ${PHASE_LANES.map((lane) =>
          renderPlaybookLane(lane.key, lane.label, playbooks.filter((playbook) => playbook.phase === lane.key)),
        ).join("")}
        ${renderUnsetPlaybookLane(playbooks)}
      </div>`
    : `<div class="run empty"><span class="name">暂无 Playbook</span></div>`;

  return `
    <div class="section-h">
      <h3>Playbook</h3>
      <span class="hint">运营动作卡片</span>
    </div>
    <div class="runs loop-panel" data-panel="playbooks">
      ${rows}
    </div>
  `;
}

function renderUnsetPlaybookLane(playbooks: NonNullable<DashboardState["playbooks"]>): string {
  const unset = playbooks.filter((playbook) => playbook.phase === undefined);
  return unset.length > 0 ? renderPlaybookLane("unset", "未分段", unset) : "";
}

function renderOpsReports(state: DashboardState): string {
  const reports = state.opsReports ?? [];
  const rows = reports.length
    ? reports.map((report) => {
      const href = report.kind === "html" && report.projectId
        ? `/previews/${encodeURIComponent(report.projectId)}/${encodeURIComponent(report.file)}`
        : "";
      const link = href
        ? `<a class="b" href="${escHtml(href)}" target="_blank" rel="noopener">查看</a>`
        : "";
      return `
        <div class="run">
          <span class="stage">${escHtml(report.kind.toUpperCase())}</span>
          <span class="name">${escHtml(report.title)}</span>
          <span class="tag">${escHtml(report.file)}</span>
          ${link}
        </div>
      `;
    }).join("")
    : `<div class="run empty"><span class="name">暂无档案</span></div>`;

  return `
    <div class="section-h">
      <h3>调研档案</h3>
      <span class="hint">reports</span>
    </div>
    <div class="runs loop-panel" data-panel="ops-reports">
      ${rows}
    </div>
  `;
}

function renderLever(lever: Lever, nextLever?: Lever, opts?: { loopId?: string; projectId?: string; action?: boolean }): string {
  const isNext = nextLever?.id === lever.id;
  const button = opts?.action
    ? `<button class="b" data-action="lever-to-task" data-loop-id="${escHtml(opts.loopId ?? "")}" data-project-id="${escHtml(opts.projectId ?? "")}" data-lever-id="${escHtml(lever.id)}" data-lever-label="${escHtml(lever.label)}">转任务</button>`
    : "";
  return `
    <div class="loop-lever${isNext ? " loop-lever-next" : ""}" data-next-lever="${isNext ? "true" : "false"}">
      <span class="name">${escHtml(lever.label)}</span>
      <span class="tag">${escHtml(lever.id)}</span>
      ${button}
    </div>
  `;
}

function renderLeverColumn(title: string, key: string, levers: Lever[], loop: LoopView): string {
  const rows = levers.length
    ? levers.map((lever) => renderLever(lever, loop.nextLever, {
      loopId: loop.id,
      projectId: loop.projectId,
      action: key === "needs-dev",
    })).join("")
    : `<div class="loop-lever empty"><span class="name">暂无</span></div>`;
  return `
    <div class="loop-lever-col" data-status="${escHtml(key)}">
      <div class="loop-lever-title">${escHtml(title)}</div>
      ${rows}
    </div>
  `;
}

function renderGotchas(loop: LoopView): string {
  const gotchas = loop.gotchas ?? [];
  if (gotchas.length === 0) {
    return `<div class="run empty"><span class="name">暂无 gotcha</span></div>`;
  }

  return gotchas
    .map((gotcha) => `<div class="run"><span class="loop-bullet"></span><span class="name">${escHtml(gotcha)}</span></div>`)
    .join("");
}

function learningKindLabel(kind: string): string {
  if (kind === "weak") return "弱项";
  if (kind === "blocked") return "卡点";
  if (kind === "win") return "高产";
  if (kind === "note") return "备注";
  return kind || "备注";
}

function renderLearnings(loop: LoopView): string {
  const learnings = loop.learnings ?? [];
  if (learnings.length === 0) {
    return `<div class="run empty"><span class="name">暂无沉淀</span></div>`;
  }

  return learnings
    .map((learning) => `<div class="run"><span class="stage">${escHtml(learningKindLabel(learning.kind))}</span><span class="name">${escHtml(learning.lesson)}</span></div>`)
    .join("");
}

function renderLoop(loop: LoopView): string {
  const leversByStatus = {
    active: loop.leversByStatus?.active ?? [],
    needsDev: loop.leversByStatus?.needsDev ?? [],
    honestZero: loop.leversByStatus?.honestZero ?? [],
  };
  const waves = loop.waves ?? [];
  const now = Date.now();
  return `
    <div class="loop-card" data-loop="${escHtml(loop.id)}">
      <div class="section-h">
        <h3>${escHtml(loop.name)}</h3>
        <span class="hint">${escHtml(loop.id)}</span>
      </div>
      ${renderJudgment(loop)}
      ${renderWeakPointsButton(loop.id, loop.projectId)}
      <div class="runs loop-panel" data-panel="overview">
        <div class="loop-overview">
          <div class="loop-metric">
            <span class="loop-value">${escHtml(loop.metric.current)}</span>
            <span class="muted">${escHtml(loop.metric.label)}</span>
            ${renderGoal(loop)}
          </div>
          <div class="loop-trend" aria-label="metricAfter 走势">${renderTrend(loop)}</div>
          <span class="stage impl">${escHtml(`累计 ${loop.waveCount ?? 0} 轮`)}</span>
        </div>
      </div>

      <div class="section-h">
        <h3>wave 时间线</h3>
        <span class="hint">最近 5 条</span>
      </div>
      ${renderOpsGotchaDiff(loop)}
      ${renderOpsMetrics(waves, now)}
      ${renderRecurringGotchas(waves)}
      <div class="runs loop-panel" data-panel="waves">
        ${renderWaveRows(loop)}
      </div>

      <div class="section-h">
        <h3>杠杆分组</h3>
        <span class="hint">next 高亮</span>
      </div>
      <div class="runs loop-panel" data-panel="levers">
        <div class="loop-levers">
          ${renderLeverColumn("active", "active", leversByStatus.active, loop)}
          ${renderLeverColumn("needs-dev", "needs-dev", leversByStatus.needsDev, loop)}
          ${renderLeverColumn("honest-zero", "honest-zero", leversByStatus.honestZero, loop)}
        </div>
      </div>

      <div class="section-h">
        <h3>经验 gotchas</h3>
        <span class="hint">去重汇总</span>
      </div>
      <div class="runs loop-panel" data-panel="lessons">
        ${renderGotchas(loop)}
      </div>

      <div class="section-h">
        <h3>已学到</h3>
        <span class="hint">learning memory</span>
      </div>
      <div class="runs loop-panel" data-panel="learnings">
        ${renderLearnings(loop)}
      </div>
    </div>
  `;
}

function renderProjectLoopGroup(
  group: ProjectLoopGroup<LoopView>,
  playbooks: NonNullable<DashboardState["playbooks"]>,
): string {
  const actionCardCount = playbooks.filter(
    (playbook) => normalizeProjectId(playbook.projectId) === group.projectId,
  ).length;

  return `
        <div class="section-h">
          <h3>项目 · ${escHtml(group.projectId)}</h3>
          <span class="hint">${escHtml(`${group.items.length} 个 loop ｜ ${actionCardCount} 张动作卡`)}</span>
        </div>
        ${group.items.map(renderLoop).join("")}
      `;
}

export function renderLoops(state: DashboardState): string {
  const loops = (state.loops ?? []).filter((loop) => loop && loop.id && loop.name);
  const statePlaybooks = state.playbooks ?? [];
  const usage = renderLoopUsage(state);
  const opsGuide = renderUsageGuide({
    id: "ops",
    title: "运营平台怎么用",
    intro: "用 loop 管指标、用 playbook 排动作、用 kunpeng ops 查看运营态。",
    steps: [
      { label: "看总览", detail: "先确认到期动作、待裁决门、停滞 loop 与顽固卡点" },
      { label: "跑运营轮次", detail: "从 loop 卡片触发下一轮", cmd: "kunpeng run <loop-id>" },
      { label: "转成任务", detail: "把 needs-dev 杠杆转进开发任务，进入自建循环" },
      { label: "复盘沉淀", detail: "查看 wave、gotcha 与报告，更新下一轮动作" },
    ],
  });
  const opsOverview = renderOpsOverview(state);
  const playbooks = renderPlaybooks(state);
  const opsReports = renderOpsReports(state);

  if (loops.length === 0) {
    return `
      <div class="body">
        <div class="wrap">
          ${opsGuide}
          ${opsOverview}
          <div class="section-h">
            <h3>运营 loop</h3>
            <span class="hint">LoopStore</span>${usage}
          </div>
          <div class="runs loop-panel" data-panel="overview">
            <div class="run empty"><span class="name">暂无运营 loop</span></div>
          </div>
          <div class="runs loop-panel" data-panel="waves">
            <div class="run empty"><span class="name">暂无 wave 时间线</span></div>
          </div>
          <div class="runs loop-panel" data-panel="levers">
            <div class="run empty"><span class="name">暂无杠杆分组</span></div>
          </div>
          <div class="runs loop-panel" data-panel="lessons">
            <div class="run empty"><span class="name">暂无 gotcha</span></div>
          </div>
          ${playbooks}
          ${opsReports}
          ${renderOpsTimeline()}
        </div>
      </div>
    `;
  }

  return `
    <div class="body">
      <div class="wrap loop-wrap">
        ${opsGuide}
        ${opsOverview}
        <div class="section-h">
          <h3>运营 loop</h3>
          <span class="hint">LoopStore</span>${usage}
        </div>
        ${playbooks}
        ${opsReports}
        ${groupByProject(loops)
          .map((group) => renderProjectLoopGroup(group, statePlaybooks))
          .join("")}
        ${renderOpsTimeline()}
      </div>
    </div>
  `;
}
