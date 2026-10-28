import type { DashboardState } from "../../state.js";
import { CLAUDE_TIER, CODEX_TIER } from "../../../agent/model-routing.js";
import type { Stage } from "../../../agent/runner.js";
import {
  renderOpsCard,
  renderProductActivity,
  renderProductHub,
  renderProductLanding,
  renderProductStationLine,
  renderProjectOps,
  renderStepBar,
  renderVersionSpine,
} from "./project-product.js";
import { escHtml, formatCount } from "./project-shared.js";

export * from "./project-product.js";

type ProjectTab = "overview" | "flows" | "plans" | "design" | "product" | "ops";
type FlowItem = DashboardState["flows"][number];

const tabs: { key: ProjectTab; label: string; future?: boolean }[] = [
  { key: "overview", label: "概览" },
  { key: "flows", label: "开发流" },
  { key: "plans", label: "方案" },
  { key: "design", label: "设计" },
  { key: "product", label: "产品" },
  { key: "ops", label: "运营" },
];

function normalizeTab(tab: string): ProjectTab {
  return tabs.some((item) => item.key === tab) ? tab as ProjectTab : "overview";
}

function projModelName(model: string): string {
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

function projFormatCount(value: number): string {
  return formatCount(value);
}

function renderTabs(projectId: string, active: ProjectTab): string {
  const id = escHtml(encodeURIComponent(projectId));
  return tabs.map((item) => {
    const cls = ["tab", item.future ? "future" : "", item.key === active ? "active" : ""].filter(Boolean).join(" ");
    const future = item.future ? ` <span class="mini">未来</span>` : "";
    return `<a class="${cls}" href="#/project/${id}/${item.key}">${escHtml(item.label)}${future}</a>`;
  }).join("");
}

function renderDesign(state: DashboardState, projectId: string): string {
  const assistant = `
    <div class="sec-h"><h3>设计工作台</h3><span class="hint">统一一条链:① 一句话快速建议 → ② 完整方案(BRIEF→配色→字体)→ ③ 一键生成(自动回炉)</span></div>
    <div class="runs" data-panel="design-workflow">
      <div class="run">
        <span class="tag step">①</span>
        <span class="name step-t">设计助手 · 一句话快速建议</span>
        <input type="text" class="name" data-design-brief placeholder="如:金融SaaS落地页 / 美妆水疗官网 / 研发工具仪表盘">
        <button class="b pri" data-action="design-advise">出快速建议</button>
      </div>
      <div class="run" data-panel="design-advise">
        <span class="hint">需求 → 风格/配色/字体 + 反AI味门禁</span>
      </div>
      <div class="run">
        <span class="tag step">②</span>
        <span class="name step-t">设计 Loop · 完整方案</span>
        <textarea class="name" data-dl-brief placeholder='完整 BRIEF(JSON,10字段):{"projectType":"研发指挥仪表盘","audience":"技术创始人","primaryGoal":"3秒判断系统健康","tone":"a calm command center","mustHave":["系统灯"],"forbidden":["紫渐变"],"techStack":"TS","locale":"both","successMetric":"3秒可判读","signature":"脉冲条"}'></textarea>
      </div>
      <div class="run" data-panel="design-loop">
        <input type="text" class="name" data-dl-seed placeholder="种子色（例：E2620E）" style="max-width:160px">
        <input type="text" class="name" data-dl-anchors placeholder="候选锚 Swiss,Organic,Industrial(留空自动建议)" style="max-width:260px">
        <button class="b pri" data-action="design-loop">跑方案(不生成)</button>
      </div>
      <div class="run">
        <span class="tag step">③</span>
        <span class="name step-t">生成页面</span>
        <input type="text" class="name" data-dl-rounds placeholder="回炉轮数 2" style="max-width:120px">
        <button class="b" data-action="design-generate">生成页面(后台·自动回炉)</button>
        <span class="hint">后台跑 design-loop --generate,产物 index.html/shot.png 落 .kunpeng/design-out</span>
      </div>
      <div class="run">
        <span class="tag step">候选</span>
        <span class="name step-t">候选生成</span>
        <select class="name" data-design-preset style="max-width:260px">
          <option value="">预设（可选，150 套）</option>
        </select>
        <button class="b pri" data-action="design-preview" data-project-id="${escHtml(projectId)}">生成候选</button>
      </div>
    </div>
    <div class="runs" id="design-advise-out" data-panel="design-advise-out"></div>
    <div class="runs" id="design-loop-out" data-panel="design-loop-out"></div>
  `;

  if (state.designCandidates.length === 0) {
    return assistant + `<div class="project-empty">暂无设计候选，可用上方设计助手生成,或在项目里发起设计</div>`;
  }

  const sig = (label: string, ok: boolean) => `<span class="sig ${ok ? "sig-ok" : "sig-bad"}">${label} ${ok ? "✓" : "✗"}</span>`;
  const gateBar = (() => {
    const v = state.designVerdict;
    if (!v) return "";

    const verdict = v.tier1AutoPass
      ? `<span class="gate-pill gate-pass">✓ 自动放行</span>`
      : v.needsHumanReview
        ? `<span class="gate-pill gate-review">⏳ 待人审（新/改基线）</span>`
        : `<span class="gate-pill gate-block">✗ 拦截</span>`;
    const blockers = v.blockers.length > 0
      ? `<span class="gate-blockers">拦截：${v.blockers.map(escHtml).join("、")}</span>`
      : "";

    return `<div class="gate-bar">${verdict}${sig("a11y", v.a11yGateable)}${sig("perf", v.perfWithinBudget)}${sig("视觉", v.visualMatchesBaseline)}${blockers}</div>`;
  })();

  const cards = state.designCandidates.map((candidate) => {
    const selected = candidate.source === state.designSelected;
    const preview = candidate.png
      ? `<img class="cand-img" src="/previews/${escHtml(projectId)}/${escHtml(candidate.png)}" alt="${escHtml(candidate.source)}">`
      : `<div class="prev" aria-hidden="true"><div class="ph" style="width:42%"></div><div class="ph" style="width:78%"></div><div class="ph" style="width:58%"></div><div class="pcard"><div class="pbtn"></div><div class="ph" style="width:50px;margin:0"></div></div></div>`;
    const legacySelectedMarker = selected ? `<!-- ${String.fromCodePoint(0x2705)} 已选 -->` : "";
    const action = selected
      ? `<div class="selbadge">${legacySelectedMarker}<span class="tick">已选 ✓</span><button class="gen" data-action="design-codegen" data-source="${escHtml(candidate.source)}" data-anchor="${escHtml(candidate.anchor)}">生成设计代码</button></div>`
      : `<button class="pick" data-action="select-design" data-source="${escHtml(candidate.source)}" data-anchor="${escHtml(candidate.anchor)}">选这套</button>`;

    return `
      <div class="cand${selected ? " sel" : ""}" data-design-candidate="${escHtml(candidate.source)}">
        ${preview}
        <div class="cand-foot">
          <div>
            <div class="nm">${escHtml(candidate.source)}</div>
            <div class="meta">${escHtml(candidate.anchor)} · #${escHtml(candidate.index)}</div>
          </div>
          ${action}
        </div>
      </div>
    `;
  }).join("");

  return assistant + `
    <div class="sec-h"><h3>设计候选</h3><span class="hint">真渲染预览 · 选择后生成设计代码</span></div>
    ${gateBar}
    <div class="cands">${cards}</div>
  `;
}

export function renderPlans(state: DashboardState): string {
  const rows = state.plans.length === 0
    ? `<div class="project-empty">暂无方案</div>`
    : `<div class="plan-cards">${state.plans.map((plan) => {
      const status = plan.merged ? "已合并" : plan.status;
      const badgeClass = plan.merged ? "merged" : `status ${escHtml(plan.status)}`;
      const segmentText = `${plan.segmentCount} 段`;
      return `
      <div class="plan-card" data-plan="${escHtml(plan.id)}">
        <div class="pc-head">
          <div class="pc-title">${escHtml(plan.desc)}</div>
          <span class="${badgeClass}">${escHtml(status)}</span>
        </div>
        <div class="pc-summary">${escHtml(plan.summary)}</div>
        <div class="pc-foot">
          <span class="pc-id">${escHtml(plan.id)}</span>
          <span class="pc-seg">${escHtml(segmentText)}</span>
          <button class="pick" data-action="view-plan" data-plan="${escHtml(plan.id)}">查看</button>
        </div>
      </div>
    `;
    }).join("")}</div>`;

  return `
    <div class="sec-h">
      <h3>方案</h3>
      <span class="hint">从项目内发起与跟踪</span>
      <button class="btn-primary plan-start" data-action="plan">起方案</button>
    </div>
    <div class="plan-list">${rows}</div>
  `;
}

function uniqueFlows(state: DashboardState): FlowItem[] {
  const byId = new Map<string, FlowItem>();
  for (const flow of [...state.running, ...state.flows]) {
    if (!byId.has(flow.flowId)) byId.set(flow.flowId, flow);
  }
  return [...byId.values()];
}

// 开发流页用的流水线 5 段(commit = 验过后的合并门,无 LLM 阶段)。
const PIPELINE: { key: string; label: string }[] = [
  { key: "spec", label: "spec" },
  { key: "audit", label: "audit" },
  { key: "implement", label: "implement" },
  { key: "verify", label: "verify" },
  { key: "commit", label: "commit" },
];

function flowCurIdx(flow: FlowItem): number {
  const s = flow.stage === "done" ? "commit" : flow.stage;
  const i = PIPELINE.findIndex((p) => p.key === s);
  return i < 0 ? 0 : i;
}

// 每段着色:done 绿 / act 当前(脉冲)/ blk 卡点红 / roll 回滚黄 / pend 待跑灰。
function segState(flow: FlowItem, idx: number): "done" | "act" | "pend" | "blk" | "roll" {
  const cur = flowCurIdx(flow);
  const activeBlock = Boolean(flow.blocker) && flow.status !== "verified" && flow.status !== "rolled-back";
  if (flow.status === "crashed" && idx === cur) return "blk";
  if (activeBlock && idx === cur) return "blk";
  if (flow.status === "verified") return idx <= 3 ? "done" : "pend";
  if (flow.status === "rolled-back") return idx < cur ? "done" : idx === cur ? "roll" : "pend";
  if (idx < cur) return "done";
  if (idx === cur) return "act";
  return "pend";
}

// 从 history 时间差算每段耗时(末段用 updatedAt/now 收口)。
function stageTiming(flow: FlowItem, now: number): Map<string, number> {
  const hist = (flow.history ?? []).slice().sort((a, b) => a.at - b.at);
  const m = new Map<string, number>();
  for (let i = 0; i < hist.length; i++) {
    const end = i + 1 < hist.length ? hist[i + 1].at : (flow.updatedAt || now);
    const key = hist[i].stage === "done" ? "commit" : hist[i].stage;
    m.set(key, (m.get(key) ?? 0) + Math.max(0, end - hist[i].at));
  }
  return m;
}

function fmtDur(ms: number): string {
  if (ms < 1000) return "";
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

const SHORT_MODEL: Record<string, string> = {
  opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", low: "Codex·low", medium: "Codex·med", high: "Codex·high",
};

// 后端 + 阶段 → 模型短名(复用 CLAUDE_TIER / CODEX_TIER,混合流按段取真实后端)。
function stageModel(flow: FlowItem, stageKey: string): string {
  if (stageKey === "commit") return "";
  const backend = flow.stageBackends?.[stageKey] ?? flow.backend;
  if (!backend) return "";
  const table = backend === "claude" ? CLAUDE_TIER : CODEX_TIER;
  const tier = table[stageKey as Stage];
  const label = tier?.model ?? tier?.effort;
  return label ? (SHORT_MODEL[label] ?? label) : "";
}

function segMeta(flow: FlowItem, key: string, timing: Map<string, number>): string {
  if (key === "commit") return "";
  const parts: string[] = [];
  const model = stageModel(flow, key);
  if (model) parts.push(model);
  const tok = flow.stageTokens?.[key];
  if (typeof tok === "number" && tok > 0) parts.push(projFormatCount(tok));
  const dur = fmtDur(timing.get(key) ?? 0);
  if (dur) parts.push(dur);
  return parts.length ? `<span class="seg-meta">${escHtml(parts.join(" · "))}</span>` : `<span class="seg-meta">·</span>`;
}

function renderFlowCard(flow: FlowItem, now: number): string {
  const timing = stageTiming(flow, now);
  const segs = PIPELINE.map((p, idx) => {
    const st = segState(flow, idx);
    return `<div class="seg ${st}">`
      + `<div class="seg-top"><span class="seg-l">${escHtml(p.label)}</span></div>`
      + `<div class="seg-bar"></div>`
      + segMeta(flow, p.key, timing)
      + `</div>`;
  }).join("");

  // verified 流:右侧挂门诊断徽章(client 按 flowId 填)+ 合并按钮。
  const fid = escHtml(flow.flowId);
  const gateSide = flow.status === "verified"
    ? `<span class="gate-diag" data-gate-diag="${fid}"></span>`
      + `<button class="pick" data-action="merge-main" data-flow="${fid}">合并主干</button>`
    : "";

  const blockerBar = flow.blocker
    ? `<div class="fc-alert blk">卡点 · ${escHtml(flow.blocker)}</div>`
    : "";
  const gateBar = flow.humanGate
    ? `<div class="fc-alert gate">需人工 · ${escHtml(flow.humanGate.gate)}：${escHtml(flow.humanGate.what)}</div>`
    : "";

  return `
    <div class="flow-card" data-flow-row="${fid}">
      <div class="fc-head">
        <div class="fc-main">
          <div class="fc-title">${escHtml(flow.requirement || flow.flowId)}</div>
          <div class="fc-id muted">${fid}</div>
        </div>
        <span class="status ${escHtml(flow.status)}">${escHtml(flow.status)}</span>
        ${gateSide}
        ${flow.status === "running" ? `<button class="pick" data-action="pause-flow" data-flow="${fid}">暂停</button>` : ""}
        ${flow.status === "stopped" ? `<button class="pick" data-action="resume-flow" data-flow="${fid}">续跑</button>` : ""}
        <button class="pick" data-action="trajectory" data-flow="${fid}">轨迹</button>
        <button class="pick" data-action="evidence" data-flow="${fid}">证据</button>
        <button class="pick" data-action="flow-log" data-flow="${fid}">日志</button>
      </div>
      <div class="pl">${segs}</div>
      ${blockerBar}${gateBar}
    </div>
  `;
}

function renderFlows(state: DashboardState): string {
  const flows = uniqueFlows(state);
  if (flows.length === 0) {
    return `
      <div class="sec-h"><h3>开发流</h3><span class="hint">流水线 · spec → audit → implement → verify → commit</span></div>
      <div class="project-empty">暂无开发流</div>
    `;
  }
  const now = Date.now();

  // 按 planId 分组,组内按 phase 排序;无 planId 的归「独立流」。
  const groups = new Map<string, FlowItem[]>();
  for (const f of flows) {
    const key = f.planId ?? "__solo__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  const blocks = [...groups.entries()].map(([planId, gflows]) => {
    gflows.sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0));
    const head = planId === "__solo__"
      ? `<div class="fg-head"><span class="fg-name">独立流</span><span class="fg-c">${gflows.length}</span></div>`
      : `<div class="fg-head"><span class="fg-name">方案 ${escHtml(planId)}</span><span class="fg-c">${gflows.length} 段</span></div>`;
    return `<div class="flow-group">${head}${gflows.map((f) => renderFlowCard(f, now)).join("")}</div>`;
  }).join("");

  return `
    <div class="sec-h"><h3>开发流</h3><span class="hint">流水线 · 每段着色+后端/token/耗时 · ~4s 自刷新</span></div>
    ${blocks}
  `;
}

function renderOverview(state: DashboardState): string {
  // 设计升级：用量从干巴文字行 → 用量卡(大字总量 + 指标标签 + 按模型可视化条)。
  // 应用 kunpeng MASTER:极简+便当格、橙色品牌(--primary)、反AI味(无紫渐变/无emoji图标/动效走主题/保focus)。
  const cost = state.costSummary;
  const models = cost?.tokensByModel ? Object.entries(cost.tokensByModel) : [];
  const maxTok = models.length ? Math.max(...models.map(([, t]) => t)) : 0;
  const modelBars = models
    .slice()
    .sort((a, b) => b[1] - a[1])
    .map(([m, t]) => {
      const pct = maxTok > 0 ? Math.round((t / maxTok) * 100) : 0;
      return `<div class="proj-model-row">`
        + `<span class="muted proj-model-name">${escHtml(projModelName(m))}</span>`
        + `<span class="proj-model-track"><span class="proj-model-fill" style="width:${pct}%"></span></span>`
        + `<span class="muted proj-model-val">${escHtml(projFormatCount(t))}</span>`
        + `</div>`;
    })
    .join("");
  const usageCard = cost
    ? `<div class="proj-usage-card">`
      + `<div class="proj-usage-head">`
      + `<span class="proj-usage-total">${escHtml(formatCount(cost.totalTokens))}</span>`
      + `<span class="muted">token 累计</span>`
      + `<span class="tag">对话 ${escHtml(formatCount(cost.llmStages))} 次</span>`
      + `<span class="tag">确定性 ${escHtml(Math.round((cost.determinismRatio ?? 0) * 100))}%</span>`
      + `<span class="tag">省下 LLM ${escHtml(formatCount(cost.savedLlmCalls ?? 0))} 次</span>`
      + `</div>`
      + (modelBars ? `<div class="proj-model-bars">${modelBars}</div>` : "")
      + `</div>`
    : `<div class="run empty"><span class="name">暂无用量</span></div>`;

  return `
    <div class="sec-h"><h3>项目概览</h3><span class="hint">关键指标</span></div>
    <div class="project-summary">
      <div class="kpi neu"><div><div class="n">${state.plans.length}</div><div class="l">方案数</div></div></div>
      <div class="kpi pri"><div><div class="n">${state.flows.length}</div><div class="l">流数</div></div></div>
      <div class="kpi suc"><div><div class="n">${escHtml(state.systemLight)}</div><div class="l">健康</div></div></div>
    </div>
    <div class="sec-h"><h3>用量</h3><span class="hint">本项目累计 · 按模型</span></div>
    ${usageCard}
  `;
}

function renderProduct(state: DashboardState): string {
  const session = state.productSession;
  const renderEmpty = () => `
    <div class="sec-h"><h3>产品定义</h3><span class="hint">DEFINE 工位 · 访谈澄清需求</span></div>
    <div class="interview">
      <div class="iv-q">发起一次 DEFINE 访谈，把模糊想法澄清成产品定义。</div>
      <input class="iv-input" placeholder="一句话描述你的产品想法…">
      <button class="btn-primary" data-action="product-start">发起 DEFINE 访谈</button>
    </div>
  `;

  if (!session) return renderEmpty();

  if (session.status === "in-progress") {
    return `
      <div class="sec-h"><h3>产品定义 · 访谈中</h3><span class="hint">DEFINE 工位</span></div>
      <div class="interview">
        <div class="iv-progress">第 ${session.answeredCount + 1}/${session.totalQuestions} 问</div>
        <div class="iv-q">${escHtml(session.currentQuestion ?? "")}</div>
        <input class="iv-input" placeholder="输入你的回答…">
        <button class="btn-primary" data-action="product-answer-submit">提交回答</button>
      </div>
    `;
  }

  const def = session.definition;
  if (!def) return renderEmpty();

  const pdefRow = (label: string, items: string[]) =>
    `<div class="pdef-row"><span class="pdef-k">${label}</span><div class="pdef-v">${items.map((item) => `<div>${escHtml(item)}</div>`).join("")}</div></div>`;

  const defBlock = `
    <div class="pdef">
      ${pdefRow("问题", [def.problem])}
      ${pdefRow("目标用户", def.users)}
      ${pdefRow("用户故事", def.stories)}
      ${pdefRow("验收标准", def.acceptance)}
    </div>`;

  const loop = session.loop;
  // loop 缺失（老数据/未起草）：回退到旧的「转 spec 草稿」入口。
  if (!loop) {
    return `
      <div class="sec-h"><h3>产品定义</h3><span class="hint">DEFINE 完成 · 可转 spec</span></div>
      ${defBlock}
      <button class="btn-primary" data-action="product-to-spec">转 spec 草稿</button>
    `;
  }

  const stepBar = renderStepBar(loop) + renderVersionSpine(state);
  const publishLine = renderProductStationLine(loop);

  if (loop.currentStage === "spec") {
    return `
      <div class="sec-h"><h3>产品轨</h3><span class="hint">机器自动起草 → 你看/改/接受才推进</span></div>
      ${stepBar}
      ${publishLine}
      ${defBlock}
      <div class="sec-h"><h3>规格 spec</h3><span class="hint">.kunpeng/product/${escHtml(loop.slug)}/spec.md · 可编辑</span></div>
      <textarea class="iv-input" data-product-spec rows="18" style="width:100%;font-family:var(--mono)">${escHtml(loop.spec ?? "")}</textarea>
      <div class="run">
        <button class="b" data-action="product-spec-save" data-slug="${escHtml(loop.slug)}">保存编辑</button>
        <button class="b pri" data-action="product-accept" data-stage="spec" data-slug="${escHtml(loop.slug)}">接受 spec 并进入设计</button>
      </div>
    `;
  }

  if (loop.currentStage === "design") {
    const briefJson = JSON.stringify(loop.brief ?? {}, null, 2);
    return `
      <div class="sec-h"><h3>产品轨</h3><span class="hint">机器自动起草 → 你看/改/接受才推进</span></div>
      ${stepBar}
      ${publishLine}
      <div class="sec-h"><h3>设计 BRIEF</h3><span class="hint">由 spec 推导 · 可编辑 JSON · 跑设计 loop 出可视预览</span></div>
      <textarea class="iv-input" data-product-brief rows="14" style="width:100%;font-family:var(--mono)">${escHtml(briefJson)}</textarea>
      <div class="run">
        <button class="b pri" data-action="product-design-run" data-slug="${escHtml(loop.slug)}">跑设计（后台生成预览）</button>
        <button class="b" data-action="product-accept" data-stage="design" data-slug="${escHtml(loop.slug)}">接受设计并进入构建</button>
        <span class="hint">产物落 .kunpeng/design-out/${escHtml(loop.slug)}/，可到「设计」tab 查看候选</span>
      </div>
    `;
  }

  if (loop.currentStage === "build") {
    const buildAccepted = loop.stages.build?.status === "accepted";
    return `
      <div class="sec-h"><h3>产品轨</h3><span class="hint">机器起草可构建 spec → 你精修/接受 → 后台拆 plan</span></div>
      ${stepBar}
      ${publishLine}
      <div class="sec-h"><h3>可构建 spec</h3><span class="hint">.kunpeng/product/${escHtml(loop.slug)}/build-spec.md · agent 起草，请人工精修（Gherkin 可能引用幻觉接口）</span></div>
      <textarea class="iv-input" data-product-buildspec rows="20" style="width:100%;font-family:var(--mono)">${escHtml(loop.buildSpec ?? "")}</textarea>
      <div class="run">
        <button class="b" data-action="product-buildspec-save">保存编辑</button>
        <button class="b pri" data-action="product-accept" data-stage="build" data-slug="${escHtml(loop.slug)}">接受并拆 plan</button>
        ${buildAccepted ? `<span class="hint">已拆 plan ✓，flow/任务见「开发流」tab</span>` : ""}
      </div>
    `;
  }

  // validate 阶段（闭环末段）
  const v = loop.validation;
  const decisionLabel: Record<string, string> = { persevere: "验证通过 ✓ · 可交付", pivot: "已 pivot ↻ · 下游已按新种子重生，见构建阶段", inconclusive: "缺真实信号 · 不能裁定，请补充遥测/真访谈/销售信号" };
  const feedbackHint = state.productOpsSummary?.feedback
    ? ` · 反馈 ${escHtml(state.productOpsSummary.feedback.count)} 条/均分 ${escHtml(state.productOpsSummary.feedback.avgScore)}`
    : "";
  const opsHint = state.productOpsSummary
    ? `<div class="ops-hint">真实信号参考：近 7 日 pv ${escHtml(state.productOpsSummary.pageviews)} · 报错 ${escHtml(state.productOpsSummary.errors)}${feedbackHint}</div>`
    : "";
  return `
    <div class="sec-h"><h3>产品轨 · 验证闭环</h3><span class="hint">录入真实信号 → 裁定 → persevere 可交付 / pivot 重生下游 / 缺真信号则不能裁定</span></div>
    ${stepBar}
    ${renderOpsCard(state.productOpsSummary, loop.slug)}
    ${publishLine}
    ${v ? `<div class="lead">本轮裁定：<b>${escHtml(decisionLabel[v.decision] ?? v.decision)}</b>${v.rationale ? `<br><span class="hint">${escHtml(v.rationale)}</span>` : ""}</div>` : ""}
    <div class="sec-h"><h3>真实信号</h3><span class="hint">每行一条「来源 | 类型(interview/telemetry/usage/sales/support) | 摘要」· 合成/空信号不能裁定 pivot·persevere</span></div>
    ${opsHint}
    <textarea class="iv-input" data-product-signals rows="6" placeholder="用户访谈 | interview | 10/12 受访者愿为此付费&#10;遥测 | telemetry | 次日留存仅 8%" style="width:100%;font-family:var(--mono)"></textarea>
    <div class="sec-h"><h3>假设</h3><span class="hint">每行一条待验证假设</span></div>
    <textarea class="iv-input" data-product-hypotheses rows="3" placeholder="研发负责人愿每天主动打开仪表盘" style="width:100%;font-family:var(--mono)"></textarea>
    <div class="run">
      <label class="hint">裁定：
        <select data-product-decision>
          <option value="persevere">persevere（坚持，进可交付）</option>
          <option value="pivot">pivot（转向，按新种子重生下游）</option>
          <option value="inconclusive">inconclusive（信号不足）</option>
        </select>
      </label>
      <input class="iv-input" data-product-rationale placeholder="裁定理由（pivot 时作为新种子方向）" style="flex:1;min-width:240px">
      <button class="b pri" data-action="product-validate-submit">提交验证</button>
    </div>
  `;
}

function renderContent(state: DashboardState, projectId: string, tab: ProjectTab): string {
  switch (tab) {
    case "overview":
      return renderOverview(state);
    case "flows":
      return renderFlows(state);
    case "plans":
      return renderPlans(state);
    case "product": {
      const hub = renderProductHub(state);
      const hasProductRegistry = Object.prototype.hasOwnProperty.call(state, "productList");
      if (!state.productSelected && hasProductRegistry) return hub + renderProductLanding(state);
      return hub + renderProduct(state) + renderProductActivity(state);
    }
    case "ops":
      return renderProjectOps(state, { projectId });
    case "design":
      return renderDesign(state, projectId);
  }
}

export function renderProject(
  state: DashboardState,
  projectId: string,
  tab: string,
  opts?: { projectName?: string }
): string {
  const active = normalizeTab(tab);
  const projectLabel = opts?.projectName || projectId;

  return `
    <div class="topbar project-topbar">
      <span class="crumb">项目 › <span class="pdot"></span> <b>${escHtml(projectLabel)}</b></span>
      <span class="spacer"></span>
      <button class="btn-primary" data-action="run">启动新工作</button>
    </div>
    <div class="tabs project-tabs">
      ${renderTabs(projectId, active)}
    </div>
    <div class="body">
      <div class="wrap project-wrap">
        ${renderContent(state, projectId, active)}
      </div>
    </div>
  `;
}
