import type { DashboardState } from "../../state.js";
import { cadenceMs } from "../../../loop/ops-run.js";
import { PRODUCT_TEMPLATES } from "../../../product/product-templates.js";
import { renderEmptyState } from "../empty-state.js";
import { escHtml } from "./project-shared.js";

export function renderProductHub(state: Pick<DashboardState, "productList" | "productArchived">): string {
  const active = (state.productList ?? []).filter((product) => product.status !== "archived");
  const archived = state.productArchived ?? [];
  const deletedHint = archived.length > 0 ? ` · ${escHtml(archived.length)} 个已删除` : "";

  return `
    <div class="sec-h"><h3>产品</h3><span class="hint">${escHtml(active.length)} 个产品${deletedHint}</span></div>
    <div class="runs">
      <div class="run">
        <input class="name" data-product-new-input placeholder="一句话描述新产品想法…">
        <select class="name" data-product-new-template>
          <option value="">不用模板</option>
          ${PRODUCT_TEMPLATES.map((template) => `<option value="${escHtml(template.id)}">${escHtml(template.label)}</option>`).join("")}
        </select>
        <button class="btn-primary" data-action="product-new">新建产品</button>
      </div>
      <div class="run">
        <input class="name" data-product-ref-input placeholder="或粘贴参考产品网址，照着抄一个…">
        <button class="b" data-action="product-copy-ref">复制参考产品</button>
      </div>
      ${active.map((p) => `
        <div class="run">
          <a class="name" data-action="product-open" data-slug="${escHtml(p.slug)}" style="cursor:pointer">${escHtml(p.title)}</a>
          <span class="tag">${escHtml(p.currentStage ?? "—")}</span>
          <span class="tag">${escHtml(p.status)}</span>
          <button class="b" data-action="product-delete" data-slug="${escHtml(p.slug)}">删除</button>
        </div>
      `).join("")}
      ${archived.map((p) => `
        <div class="run">
          <span class="name">${escHtml(p.title)}</span>
          <span class="tag">已删除</span>
          <button class="b" data-action="product-restore" data-slug="${escHtml(p.slug)}">恢复</button>
          <button class="b" data-action="product-purge" data-slug="${escHtml(p.slug)}">彻底删除</button>
        </div>
      `).join("")}
    </div>
  `;
}

export function renderProductLanding(state: Pick<DashboardState, "productList">): string {
  const has = (state.productList ?? []).length > 0;
  if (!has) {
    return renderEmptyState({
      title: "还没有产品",
      hint: "一句话就能开始第一个",
      actions: [{ label: "新建产品", action: "product-new" }],
    });
  }
  const msg = has
    ? "点上方任一产品标题，进入它的五阶段工位（定义 → 规格 → 设计 → 构建 → 验证）；或用「新建产品 / 复制参考产品」起一个新的。"
    : "";
  return `<div class="project-empty">${msg}</div>`;
}

export function renderOpsCard(
  summary: {
    pageviews: number;
    errors: number;
    topEvents: Array<{ name: string; count: number }>;
    feedback?: { count: number; avgScore: number; recent: Array<{ score: number; comment?: string; at: number }> };
  } | undefined,
  slug: string,
): string {
  if (!summary) {
    const snippet = `<script src="/kp-beacon.js?slug=${slug}"></script>`;
    return `
      <div class="ops-card">
        <div class="ops-card-title">运营健康</div>
        <div class="hint">尚无运营数据</div>
        <code>${escHtml(snippet)}</code>
      </div>
    `;
  }

  const topEvents = summary.topEvents.length > 0
    ? summary.topEvents
      .map((event) => `<div class="ops-event">${escHtml(event.name)} × ${escHtml(event.count)}</div>`)
      .join("")
    : `<div class="hint">暂无 top 事件</div>`;
  const feedback = summary.feedback
    ? `
      <div class="ops-feedback">反馈 ${escHtml(summary.feedback.count)} 条 · 均分 ${escHtml(summary.feedback.avgScore)}</div>
      ${summary.feedback.recent
        .map((item) => `<div class="ops-event">★${escHtml(item.score)} ${escHtml((item.comment ?? "").slice(0, 80))}</div>`)
        .join("")}
    `
    : "";

  return `
    <div class="ops-card">
      <div class="ops-card-title">运营健康 · 近 7 日</div>
      <div class="ops-metrics">
        <span>pv ${escHtml(summary.pageviews)}</span>
        <span>报错 ${escHtml(summary.errors)}</span>
      </div>
      <div class="ops-events">${topEvents}</div>
      ${feedback}
    </div>
  `;
}

function lastRunByLoop(loops: NonNullable<DashboardState["loops"]>): Map<string, number> {
  const lastRuns = new Map<string, number>();
  for (const loop of loops) {
    for (const wave of loop.waves ?? []) {
      const current = lastRuns.get(loop.id);
      if (current === undefined || wave.at > current) {
        lastRuns.set(loop.id, wave.at);
      }
    }
  }
  return lastRuns;
}

export function renderProjectOps(
  state: Pick<DashboardState, "playbooks" | "loops">,
  opts?: { now?: number; projectId?: string },
): string {
  const playbooks = state.playbooks ?? [];
  if (playbooks.length === 0) {
    return `<div class="sec"><div class="sec-h"><h3>运营方案</h3></div>${renderEmptyState({
      title: "该项目还没有运营 playbook",
      hint: "用 kunpeng solution apply <模板> --project <id> 一键装入一套方案",
    })}</div>`;
  }

  const now = opts?.now ?? Date.now();
  const lastRuns = lastRunByLoop(state.loops ?? []);
  const cards = playbooks.map((playbook) => {
    const skills = playbook.skills ?? [];
    const loopId = playbook.loopId;
    const lastRun = loopId ? lastRuns.get(loopId) : undefined;
    const due = Boolean(loopId && (lastRun === undefined || now - lastRun >= cadenceMs(playbook.cadence)));
    const dueText = !loopId
      ? "未接 loop"
      : due
        ? "<b>到期待跑</b>"
        : "未到期";
    const runButton = due && loopId
      ? ` <button class="b" data-ops-run="${escHtml(loopId)}" data-project="${escHtml(opts?.projectId ?? "")}">跑一波</button>`
      : "";
    return `
      <div class="ops-card">
        <div class="ops-card-title">${escHtml(playbook.title)}</div>
        <div class="hint">${escHtml(playbook.phase ?? "未分阶段")} · ${escHtml(playbook.cadence ?? "weekly")} · ${playbook.gate === "auto" ? "自动" : "需复核"}</div>
        ${skills.length > 0
          ? `<div class="pb-skills">技能: ${skills.map((skill) => `<code>${escHtml(skill)}</code>`).join(" ")}</div>`
          : `<div class="pb-skills hint">未声明技能</div>`}
        <div class="hint">${dueText}${runButton}</div>
      </div>
    `;
  }).join("");

  return `<div class="sec"><div class="sec-h"><h3>运营方案</h3><span class="hint">该项目组合的运营动作（playbook × 技能）</span></div>${cards}</div>`;
}

function renderSeoHints(seoHints?: string[]): string {
  if (!seoHints || seoHints.length === 0) return "";
  return `
    <div class="seo-hints">
      <span class="hint">SEO 提示</span>
      ${seoHints.map((hint) => `<span class="tag">${escHtml(hint)}</span>`).join("")}
    </div>
  `;
}

export function renderQaEvidence(qa: { ok: boolean; problems?: string[]; seoHints?: string[] } | undefined): string {
  if (!qa) return "";
  const seoHints = renderSeoHints(qa.seoHints);
  if (qa.ok) return `<span class="tag">QA 通过</span>${seoHints}`;
  const problems = qa.problems ?? [];
  const visibleProblems = problems
    .slice(0, 3)
    .map((problem) => `<div class="qa-problem">${escHtml(problem).slice(0, 120)}</div>`)
    .join("");
  const remaining = problems.length > 3 ? `<div class="qa-problem-more">…等 ${escHtml(String(problems.length - 3))} 条</div>` : "";
  return `
    <div class="qa-evidence">
      <span class="tag">QA 问题 ${escHtml(String(problems.length))}</span>
      ${visibleProblems}
      ${remaining}
      <a href="#/tasks">已自动生成修复任务 → 任务台</a>
    </div>
  ${seoHints}`;
}

export function renderProductStationLine(loop: NonNullable<DashboardState["productSession"]>["loop"]): string {
  if (!loop) return "";
  const qaSource = loop.qa as { ok: boolean; problems?: string[]; seoHints?: string[] } | undefined;
  const qa = qaSource
    ? renderQaEvidence({ ok: qaSource.ok, problems: qaSource.problems, seoHints: qaSource.seoHints })
    : `<span class="tag">QA 未跑</span>`;
  const previewErrors = loop.previewErrors && loop.previewErrors.length > 0
    ? `
      <div class="preview-errors">
        <div>预览日志报错</div>
        ${loop.previewErrors.map((line) => `<span class="tag">${escHtml(line)}</span>`).join("")}
        <span class="hint">跑 QA 走查可自动生成修复任务</span>
      </div>
    `
    : "";
  const preview = loop.preview?.alive
    ? `
      <button class="b" data-action="product-preview-stop" data-slug="${escHtml(loop.slug)}">停预览</button>
      <a class="b" href="${escHtml(`${loop.preview.url}?kp-pick=1`)}" target="_blank" rel="noreferrer">选元素改</a>
      <a class="name" href="${escHtml(loop.preview.url)}" target="_blank" rel="noreferrer">${escHtml(loop.preview.url)}</a>
    `
    : `<button class="b" data-action="product-preview-start" data-slug="${escHtml(loop.slug)}">起预览</button>`;
  const qaRun = loop.preview?.alive
    ? `<button class="b" data-action="product-qa-run" data-slug="${escHtml(loop.slug)}">重跑 QA</button>`
    : "";
  const pickedElements = loop.picks && loop.picks.length > 0
    ? `
      <div class="picked-elements">
        <div>已拾取元素</div>
        ${loop.picks.map((pick) => {
          const text = pick.text ?? "";
          return `
            <div class="run">
              <span class="tag">${escHtml(pick.selector)}</span>
              ${text ? `<span class="hint">${escHtml(text)}</span>` : ""}
              <button class="b" data-action="product-pick-task" data-slug="${escHtml(loop.slug)}" data-selector="${escHtml(pick.selector)}" data-text="${escHtml(text)}">生成修改任务</button>
            </div>
          `;
        }).join("")}
      </div>
    `
    : "";
  if (loop.publish) {
    return `
      <div class="run">
        <button class="b pri" data-action="product-checkup" data-slug="${escHtml(loop.slug)}">一键验收</button>
        ${preview}
        <span class="tag">已发布(本地)</span>
        <a class="name" href="${escHtml(loop.publish.url)}" target="_blank" rel="noreferrer">${escHtml(loop.publish.url)}</a>
        ${qa}
        ${qaRun}
        ${previewErrors}
        ${pickedElements}
      </div>
    `;
  }
  return `
    <div class="run">
      <button class="b pri" data-action="product-checkup" data-slug="${escHtml(loop.slug)}">一键验收</button>
      ${preview}
      <button class="b" data-action="product-publish" data-slug="${escHtml(loop.slug)}">发布(本地)</button>
      ${qa}
      ${qaRun}
      ${previewErrors}
      ${pickedElements}
    </div>
  `;
}

export function renderProductActivity(state: Pick<DashboardState, "productActivity">): string {
  const acts = state.productActivity ?? [];
  if (acts.length === 0) return "";
  const rows = acts.map((a) => `<div class="run"><b>${escHtml(a.actor)}</b> ${escHtml(a.summary)}<span class="hint"> · ${escHtml(a.kind)}${a.stage ? " · " + escHtml(a.stage) : ""}</span></div>`).join("");
  return `<div class="sec-h"><h3>活动</h3><span class="hint">${acts.length} 条</span></div><div class="runs">${rows}</div>`;
}

const PRODUCT_STAGE_LABELS: Record<string, string> = {
  define: "定义",
  spec: "规格",
  design: "设计",
  build: "构建",
  validate: "验证",
};

export function renderVersionSpine(state: DashboardState): string {
  const productSelected = (state as { productSelected?: unknown }).productSelected;
  if (!productSelected) return "";
  const slug = state.productSession?.loop?.slug ?? (typeof productSelected === "string" ? productSelected : "");
  const cks = state.productCheckpoints ?? [];
  const workspaceVersions = state.productSession?.loop?.workspaceVersions ?? [];
  const rows = cks.length === 0
    ? `<div class="run"><span class="hint">暂无版本</span></div>`
    : cks.map((c) => {
        const stage = c.stage ? `<span class="tag">${escHtml(PRODUCT_STAGE_LABELS[c.stage] ?? c.stage)}</span>` : "";
        return `<div class="run"><b>${escHtml(c.label)}</b>${stage}<span class="hint"> · ${escHtml(String(c.ts))}</span><button class="b" data-action="product-rollback" data-slug="${escHtml(slug)}" data-id="${escHtml(c.id)}">恢复</button></div>`;
      }).join("");
  const workspaceVersionsHtml = workspaceVersions.length === 0
    ? ""
    : `
      <div class="ws-versions">
        <div class="sec-h"><h3>代码版本</h3><span class="hint">最近 10 条</span></div>
        <div class="runs">
          ${workspaceVersions.map((v) => `<div class="run"><span class="tag">${escHtml(v.sha.slice(0, 8))}</span> ${escHtml(v.message)}<button class="b" data-action="product-ws-restore" data-slug="${escHtml(slug)}" data-sha="${escHtml(v.sha)}">恢复此版</button></div>`).join("")}
        </div>
      </div>
    `;
  return `
    <div class="version-spine">
      <div class="sec-h"><h3>版本</h3><span class="hint">只加不减 · 恢复前自动存当前</span></div>
      <div class="runs">
        <div class="run"><button class="b" data-action="product-snapshot" data-slug="${escHtml(slug)}">存档</button></div>
        ${rows}
      </div>
      ${workspaceVersionsHtml}
    </div>
  `;
}

export function renderStepBar(loop: { currentStage: string; stages: Record<string, { status: string }> }): string {
  const stages: Array<[string, string]> = [["define", "定义"], ["spec", "规格"], ["design", "设计"], ["build", "构建"], ["validate", "验证"]];
  const cells = stages.map(([key, label]) => {
    const st = loop.stages?.[key]?.status ?? "pending";
    const cur = loop.currentStage === key;
    const icon = cur ? "◉" : (st === "accepted" || st === "done") ? "✓" : "○";
    return `<span class="step-cell ${st}${cur ? " cur" : ""}"><span class="step-ico">${icon}</span> ${label}</span>`;
  }).join(`<span class="step-sep">→</span>`);
  return `<div class="step-bar">${cells}</div>`;
}
