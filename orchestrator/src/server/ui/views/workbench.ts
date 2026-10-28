import { escHtml } from "../../../util/esc-html.js";
import type { DashboardState, EvolutionProposalView, ReviewItem, StateItem } from "../../state.js";
import { renderWorkbenchPanel } from "../workbench-panel.js";

type KpiVariant = "neu" | "pri" | "wrn" | "suc";
type NextStepTone = "danger" | "primary" | "neutral";
type NextStep = { text: string; href: "#/overview" | "#/inbox"; tone: NextStepTone };

function kpi(
  href: "#/overview" | "#/inbox",
  label: string,
  value: number,
  variant: KpiVariant,
  iconPath: string,
): string {
  return `
    <a class="kpi ${variant}" href="${href}">
      <span class="chip" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${iconPath}</svg></span>
      <div>
        <div class="n">${escHtml(value)}</div>
        <div class="l">${escHtml(label)}</div>
      </div>
    </a>
  `;
}

function section(title: string, count: number | undefined, body: string): string {
  const counter = count === undefined ? "" : `<span class="cnt">${escHtml(count)}</span>`;
  return `
    <div class="section-h">
      <h3>${escHtml(title)}</h3>
      ${counter}
    </div>
    <div class="runs">
      ${body}
    </div>
  `;
}

function gateIsMerge(gate: DashboardState["humanGates"][number]): boolean {
  return gate.what.includes("合并");
}

function gateIsProposal(gate: DashboardState["humanGates"][number]): boolean {
  return gate.what.includes("提案") || gate.what.includes("进化");
}

function nextStep(state: DashboardState): NextStep {
  const blockers = state.blockers ?? [];
  const alerts = state.health?.alerts ?? [];
  const stuckCount = blockers.length + alerts.length;
  if (stuckCount > 0) {
    return { text: `${stuckCount} 处流卡住/告警，先去看 →`, href: "#/overview", tone: "danger" };
  }

  const queue = state.reviewQueue;
  const releaseDrafts = (state.artifacts?.["release"] ?? []).filter((a) => a.status === "draft");
  const connectorDrafts = (state.artifacts?.["connector"] ?? []).filter((a) => a.status === "draft");
  const gates = state.humanGates ?? [];
  const releaseCount = queue ? queue.filter((item) => item.kind === "release").length : releaseDrafts.length;
  const connectorCount = queue ? queue.filter((item) => item.kind === "connector").length : connectorDrafts.length;
  const proposalCount = queue ? queue.filter((item) => item.kind === "proposal").length : gates.filter(gateIsProposal).length;
  const mergeCount = queue ? queue.filter((item) => item.kind === "merge").length : gates.filter(gateIsMerge).length;

  if (releaseCount > 0) {
    return { text: `${releaseCount} 个构建待你确认发布 →`, href: "#/inbox", tone: "primary" };
  }
  if (connectorCount > 0) {
    return { text: `${connectorCount} 个高风险动作待放行 →`, href: "#/inbox", tone: "primary" };
  }
  if (proposalCount > 0) {
    return { text: `${proposalCount} 条自进化提案待审 →`, href: "#/inbox", tone: "primary" };
  }
  if (mergeCount > 0) {
    return { text: `${mergeCount} 条已验证待合并（可开自动驾驶）→`, href: "#/inbox", tone: "neutral" };
  }

  const running = state.running ?? [];
  if (running.length > 0) {
    return { text: `${running.length} 条流在跑，稍后回来看 →`, href: "#/overview", tone: "neutral" };
  }
  return { text: "一切就绪，可起个新需求 →", href: "#/overview", tone: "neutral" };
}

function nextStepBanner(step: NextStep): string {
  const toneClass: Record<NextStepTone, string> = {
    danger: "stage impl",
    primary: "stage verify",
    neutral: "muted",
  };
  return `
    <a class="run" href="${step.href}">
      <span class="tag">今日下一步</span>
      <span class="${toneClass[step.tone]}">${escHtml(step.text)}</span>
    </a>
  `;
}

function draftRow(item: StateItem, kind: "release" | "connector"): string {
  return [
    `<div class="run">`,
    `<span class="tag">${kind === "release" ? "发布" : "connector"}</span>`,
    `<span class="name">${escHtml(item.id)}</span>`,
    `<span class="muted">${escHtml(item.summary)}</span>`,
    `</div>`,
  ].join("");
}

function outputRow(item: StateItem): string {
  return [
    `<div class="run">`,
    `<span class="tag">${escHtml(item.kind)}</span>`,
    `<span class="name">${escHtml(item.id)}</span>`,
    `<span class="muted">${escHtml(item.summary)}</span>`,
    `</div>`,
  ].join("");
}

function proposalRow(proposal: EvolutionProposalView): string {
  const evidence = proposal.hasEvidence ? `<span class="stage verify">证据</span>` : "";
  return [
    `<div class="run">`,
    `<span class="tag">提案</span>`,
    `<span class="name">${escHtml(proposal.id)}</span>`,
    `<span class="muted">${escHtml(proposal.summary)}</span>`,
    evidence,
    `</div>`,
  ].join("");
}

function reviewQueueRow(item: ReviewItem): string {
  return [
    `<div class="run" data-project="${escHtml(item.projectId)}">`,
    `<span class="tag">${escHtml(item.projectName)}</span>`,
    `<span class="tag">${escHtml(item.kind)}</span>`,
    `<span class="name">${escHtml(item.title)}</span>`,
    `<span class="muted">${escHtml(item.detail)}</span>`,
    `</div>`,
  ].join("");
}

export function renderWorkbench(state: DashboardState): string {
  const running = state.running ?? [];
  const blockers = state.blockers ?? [];
  const alerts = state.health?.alerts ?? [];
  const gates = state.humanGates ?? [];
  const releaseDrafts = (state.artifacts?.["release"] ?? []).filter((a) => a.status === "draft");
  const connectorDrafts = (state.artifacts?.["connector"] ?? []).filter((a) => a.status === "draft");
  const queue = state.reviewQueue;
  const needsReview = queue ? queue.length : gates.length + releaseDrafts.length + connectorDrafts.length;
  const releaseCount = queue ? queue.filter((item) => item.kind === "release").length : releaseDrafts.length;
  const experiences = (state.artifacts?.["experience"] ?? []).slice(-5).reverse();
  const proposals = (state.evolution?.proposals ?? []).slice(0, 5);
  const step = nextStep(state);

  const decisions = queue
    ? queue.map(reviewQueueRow)
    : [
        ...gates.slice(0, 6).map((gate) => [
          `<div class="run" data-flow="${escHtml(gate.flowId)}">`,
          `<span class="tag">人工门</span>`,
          `<span class="name">${escHtml(gate.what)}</span>`,
          `<span class="muted">${escHtml(gate.detail)}</span>`,
          `</div>`,
        ].join("")),
        ...releaseDrafts.slice(0, 4).map((item) => draftRow(item, "release")),
        ...connectorDrafts.slice(0, 4).map((item) => draftRow(item, "connector")),
      ];
  const decisionBody = decisions.length === 0
    ? `<div class="run empty"><span class="name">暂无待决策</span></div>`
    : `${decisions.join("")}<div class="run"><a class="more" href="#/inbox">去待我处理逐条拍板 -&gt;</a></div>`;

  const runningBody = running.length === 0
    ? `<div class="run empty"><span class="name">当前没有运行中的流</span></div>`
    : running.slice(0, 8).map((flow) => {
      const project = flow.project ? `<span class="tag">${escHtml(flow.project.name)}</span>` : "";
      return [
        `<div class="run" data-flow="${escHtml(flow.flowId)}">`,
        `<span class="tag">${escHtml(flow.flowId)}</span>`,
        project,
        `<span class="stage impl">${escHtml(flow.stage)}</span>`,
        `</div>`,
      ].join("");
    }).join("");

  const problems = [
    ...blockers.slice(0, 8).map((blocker) => [
      `<div class="run" data-flow="${escHtml(blocker.flowId)}">`,
      `<span class="tag">${escHtml(blocker.flowId)}</span>`,
      `<span class="stage impl">${escHtml(blocker.stage)}</span>`,
      `<span class="muted">${escHtml(blocker.reason)}</span>`,
      `</div>`,
    ].join("")),
    ...alerts.slice(0, 8).map((alert) => [
      `<div class="run" data-flow="${escHtml(alert.flowId)}">`,
      `<span class="tag">${alert.kind === "stuck" ? "卡住" : "长跑"}</span>`,
      `<span class="tag">${escHtml(alert.flowId)}</span>`,
      `<span class="stage impl">${escHtml(alert.stage)}</span>`,
      `<span class="muted">${Math.max(1, Math.round(alert.ageMs / 60000))} 分钟未收敛</span>`,
      `</div>`,
    ].join("")),
  ];
  const problemBody = problems.length === 0
    ? `<div class="run empty"><span class="name">无告警</span></div>`
    : problems.join("");

  const outputs = [
    ...experiences.map(outputRow),
    ...proposals.map(proposalRow),
  ];
  const outputBody = outputs.length === 0
    ? `<div class="run empty"><span class="name">暂无最近产出</span></div>`
    : outputs.join("");

  const summaryHtml = `
    <div class="body">
      <div class="wrap">
        <div class="section-h">
          <h3>现在需要我做什么</h3>
          <span class="hint">跨项目工作台</span>
        </div>
        ${nextStepBanner(step)}
        <div class="kpis">
          ${kpi("#/overview", "正在跑", running.length, "neu", `<path d="M3 12h4l3 8 4-16 3 8h4"/>`)}
          ${kpi("#/overview", "失败/卡住", blockers.length + alerts.length, "wrn", `<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>`)}
          ${kpi("#/inbox", "等人审", needsReview, "pri", `<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1z"/>`)}
          ${kpi("#/inbox", "可发布", releaseCount, "suc", `<path d="M5 13l4 4L19 7"/>`)}
        </div>
        ${section("需要我决策", needsReview, decisionBody)}
        ${section("在跑", running.length, runningBody)}
        ${section("出问题", blockers.length + alerts.length, problemBody)}
        ${section("最近产出", experiences.length + proposals.length, outputBody)}
      </div>
    </div>
  `;
  return renderWorkbenchPanel(summaryHtml);
}
