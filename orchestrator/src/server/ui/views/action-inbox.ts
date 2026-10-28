import { buildVerdictLine, buildNeedsYou, buildProjectRollup } from "../../../cockpit/action-home.js";
import type { OpsGateEntry } from "../../../loop/ops-gate.js";
import { escHtml as escapeHtml } from "../../../util/esc-html.js";

export interface ActionInboxInput {
  humanGates?: { what: string; detail: string; flowId: string; project?: string; preReview?: { verdict: string; reason: string } }[];
  failures?: { flowId: string; requirement?: string; reason?: string; project?: string }[];
  blockers?: { flowId: string; stage: string; reason: string; project?: string }[];
  runningCount?: number;
  projectFlows?: { project: string; status: string }[];
  opsGates?: OpsGateEntry[];
}

function projectToneClass(tone: "red" | "yellow" | "green"): "tag-danger" | "tag-warn" | "tag-ok" {
  if (tone === "red") return "tag-danger";
  if (tone === "yellow") return "tag-warn";
  return "tag-ok";
}

function prereviewLabel(verdict: string): string {
  if (verdict === "approve") return "建议批准";
  if (verdict === "reject") return "建议拒绝";
  return "需细看";
}

function prereviewClass(verdict: string): "tag-ok" | "tag-danger" | "tag-warn" {
  if (verdict === "approve") return "tag-ok";
  if (verdict === "reject") return "tag-danger";
  return "tag-warn";
}

export function renderActionInbox(input: ActionInboxInput): string {
  const humanGates = input.humanGates ?? [];
  const failures = input.failures ?? [];
  const blockers = input.blockers ?? [];
  const runningCount = input.runningCount ?? 0;
  const projectFlows = input.projectFlows ?? [];
  const pendingOpsGates = (input.opsGates ?? []).filter((gate) => gate.status === "pending");
  const verdictLine = buildVerdictLine({
    gates: humanGates.length,
    failed: failures.length,
    running: runningCount,
  });
  const projectRollup = buildProjectRollup(projectFlows);
  const projectLights = projectRollup.length === 0
    ? ""
    : `
      <div class="proj-lights">
        ${projectRollup.map((project) => `<span class="tag ${projectToneClass(project.tone)}">${escapeHtml(project.project)} · ${escapeHtml(project.running)} 在跑</span>`).join("")}
      </div>
    `;

  const queue = buildNeedsYou({
    humanGates,
    failures,
    blockers,
  });
  const queueCardsHtml = queue.map((item) => {
        const flowId = escapeHtml(item.flowId);
        const project = escapeHtml(item.project ?? "");
        const title = escapeHtml(item.title);
        const detail = escapeHtml(item.detail);

        if (item.kind === "gate") {
          const prereview = item.prereview
            ? `<div class="ruletxt">🤖 预审 <span class="tag ${prereviewClass(item.prereview.verdict)}">${prereviewLabel(item.prereview.verdict)}</span> ${escapeHtml(item.prereview.reason)}</div>`
            : "";
          return `
            <div class="gate" data-flow="${flowId}" data-project="${project}">
              <div class="gate-h"><span class="tag">合并</span><div><div class="ti">${title}</div><div class="mt">${detail}</div></div><span class="stage impl">人工门 #1</span></div>
              ${prereview}
              <div class="gate-b"><div class="acts">
                <button class="b ok" data-action="merge-main" data-flow="${flowId}" data-project="${project}">✓ 合并主干</button>
                <button class="b gh" data-action="gate-diff" data-flow="${flowId}" data-project="${project}">看改动</button>
                <button class="b dn" data-action="reject" data-flow="${flowId}" data-project="${project}">拒绝</button>
              </div></div>
            </div>
          `;
        }

        if (item.kind === "failed") {
          return `<div class="gate" data-flow="${flowId}" data-project="${project}"><div class="gate-h"><span class="tag tag-danger">失败</span><div><div class="ti">${title}</div><div class="mt">${detail}</div></div></div><div class="gate-b"><div class="acts"><button class="b ok" data-action="rerun-flow" data-flow="${flowId}" data-project="${project}">重跑</button><button class="b gh" data-action="gate-diff" data-flow="${flowId}" data-project="${project}">看改动</button></div></div></div>`;
        }

        return `<div class="gate" data-flow="${flowId}" data-project="${project}"><div class="gate-h"><span class="tag tag-warn">卡住</span><div><div class="ti">${title}</div><div class="mt">${detail}</div></div></div><div class="gate-b"><div class="acts"><button class="b ok" data-action="resume-flow" data-flow="${flowId}" data-project="${project}">续跑</button><button class="b dn" data-action="abandon-flow" data-flow="${flowId}" data-project="${project}">中止</button></div></div></div>`;
      }).join("");
  const opsGateCardsHtml = pendingOpsGates.map((gate) => {
    const id = escapeHtml(gate.id);
    const project = escapeHtml(gate.projectId);
    const level = escapeHtml(gate.level ?? "");
    return `
            <div class="gate" data-ops-gate="${id}" data-project="${project}">
              <div class="gate-h"><span class="tag tag-warn">运营门</span><div><div class="ti">${escapeHtml(gate.playbookId)}</div><div class="mt">${escapeHtml(gate.reason)}</div></div></div>
              <div class="gate-b"><div class="acts">
                <button class="b ok" data-action="ops-gate-approve" data-id="${id}" data-project="${project}" data-level="${level}">批准并起跑</button>
                <button class="b dn" data-action="ops-gate-reject" data-id="${id}" data-project="${project}">驳回</button>
              </div></div>
            </div>
          `;
  }).join("");
  const queueHtml = queue.length === 0 && pendingOpsGates.length === 0
    ? `<div class="gate gate-calm"><div class="ti">没有待你处理的事 ✓</div><div class="mt">AI 全自动运行中,有门/失败/卡住会自动浮到这里</div></div>`
    : `${queueCardsHtml}${opsGateCardsHtml}`;

  return `
    <section class="action-inbox">
      <div class="section-h"><h3>待我处理</h3><span class="hint">${escapeHtml(verdictLine)}</span></div>
      ${projectLights}
      ${queueHtml}
    </section>
  `;
}
