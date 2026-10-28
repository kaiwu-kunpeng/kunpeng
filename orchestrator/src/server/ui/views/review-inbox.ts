import { escHtml } from "../../../util/esc-html.js";
import { actionLevelRow } from "../../../policy/action-levels.js";
import { isRaiseBlocker, raiseBlockerReason } from "../../../runtime/raise-blocker.js";
import { isHardGate, reviewItemOrder, reviewItemOwners, type DashboardState, type ReviewItem, type StateItem } from "../../state.js";
import { inboxUnreadCss } from "../workbench-panel.js";
import { confidenceLabel, groupByLane, originLabel } from "../../inbox-triage.js";

const replyCss = ".kp-reply{display:block;width:100%;min-height:72px;margin:8px 0;padding:8px 10px;font:inherit;font-size:13px;line-height:1.5;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;resize:vertical}.kp-reply::placeholder{color:var(--muted)}";

type HumanGate = DashboardState["humanGates"][number];
type OpsGate = NonNullable<DashboardState["opsGates"]>[number];

export function isInboxItemUnread(
  item: { kind: string; id: string },
  seenKeys?: readonly string[],
): boolean {
  if (seenKeys === undefined) return true;
  return !seenKeys.includes(`${item.kind}:${item.id}`);
}

function gateClass(item: { kind: string; id: string }, seenKeys?: readonly string[]): string {
  return isInboxItemUnread(item, seenKeys) ? "gate kp-inbox-unread" : "gate";
}

function detailText(gate: HumanGate): string {
  return [gate.detail, gate.flowId].filter(Boolean).map(escHtml).join(" · ");
}

function renderMerge(gate: HumanGate, seenKeys?: readonly string[]): string {
  const flowId = escHtml(gate.flowId);
  return `
    <div class='${gateClass({ kind: "merge", id: gate.flowId }, seenKeys)}' data-kp-inbox-item data-kp-inbox-id="merge:${flowId}" data-flow="${flowId}">
      <div class="gate-h">
        <span class="tag">合并</span>
        <div>
          <div class="ti">${escHtml(gate.what)}</div>
          <div class="mt">${detailText(gate)}</div>
        </div>
        <span class="stage impl">人工门 #1</span>
        <span class="gate-diag" data-gate-diag="${flowId}"></span>
      </div>
      <div class="gate-b">
        <div class="ruletxt">${escHtml(gate.detail || gate.flowId)}</div>
        <div class="acts">
          <button class="b ok" data-kp-act="approve" data-action="merge-main" data-flow="${flowId}">✓ 合并主干</button>
          <button class="b gh" data-kp-act="detail" data-action="gate-diff" data-flow="${flowId}">看改动</button>
          <button class="b gh" data-action="view" data-flow="${flowId}">查看</button>
          <button class="b dn" data-kp-act="reject" data-action="reject" data-flow="${flowId}">拒绝</button>
        </div>
      </div>
    </div>
  `;
}

function renderProposal(gate: HumanGate, seenKeys?: readonly string[]): string {
  const id = escHtml(gate.flowId);
  return `
    <div class='${gateClass({ kind: "proposal", id: gate.flowId }, seenKeys)}' data-kp-inbox-item data-kp-inbox-id="proposal:${id}" data-id="${id}">
      <div class="gate-h">
        <span class="tag">提案</span>
        <div>
          <div class="ti">${escHtml(gate.what)}</div>
          <div class="mt">${detailText(gate)}</div>
        </div>
        <span class="stage impl">人工门 #2</span>
      </div>
      <div class="gate-b">
        <div class="ruletxt">${escHtml(gate.detail || gate.flowId)}</div>
        <div class="acts">
          <button class="b pri" data-kp-act="approve" data-action="approve-apply" data-id="${id}">✓ 批准应用</button>
          <button class="b gh" data-action="edit" data-id="${id}">编辑</button>
          <button class="b dn" data-kp-act="reject" data-action="reject" data-id="${id}">拒绝</button>
        </div>
      </div>
    </div>
  `;
}

function renderArtifact(item: StateItem, kind: "release" | "connector", seenKeys?: readonly string[]): string {
  const id = escHtml(item.id);
  const isRelease = kind === "release";
  return `
    <div class='${gateClass({ kind, id: item.id }, seenKeys)}' data-kp-inbox-item data-kp-inbox-id="${kind}:${id}" data-id="${id}">
      <div class="gate-h">
        <span class="tag">${isRelease ? "发布" : "connector"}</span>
        <div>
          <div class="ti">${escHtml(item.id)}</div>
          <div class="mt">${escHtml(item.summary)}</div>
        </div>
        <span class="stage impl">${escHtml(item.status)}</span>
      </div>
      <div class="gate-b">
        <div class="ruletxt">${escHtml(item.summary)}</div>
        <div class="acts">
          ${
            isRelease
              ? `<button class="b ok" data-kp-act="approve" data-action="confirm-release" data-id="${id}">✓ 确认发布</button>`
              : `<button class="b pri" data-kp-act="approve" data-action="approve-connector" data-id="${id}">✓ 放行</button>`
          }
          <button class="b dn" data-kp-act="reject" data-action="reject" data-id="${id}">拒绝</button>
        </div>
      </div>
    </div>
  `;
}

function renderQueueItem(item: ReviewItem, seenKeys?: readonly string[]): string {
  const id = escHtml(item.id);
  const projectId = escHtml(item.projectId);
  const projectName = escHtml(item.projectName);
  const raised = item.kind === "blocked" && isRaiseBlocker(item.title);
  const title = escHtml(raised ? raiseBlockerReason(item.title) : item.title);
  const detail = escHtml(item.detail);
  const isMerge = item.kind === "merge";
  const isOpsGate = item.kind === "ops-gate";
  const inboxKind = isOpsGate ? "ops" : item.kind;
  const { blastRadius, evidence, costUsd, owner } = item.decision ?? {};
  const row = blastRadius ? actionLevelRow(blastRadius) : undefined;
  const level = escHtml(blastRadius);
  const isNotification = item.kind === "failed" || item.kind === "blocked" || item.kind === "alert" || item.kind === "budget";
  const hardGate = !isNotification && isHardGate(item);
  const confirmAttr = hardGate && row
    ? ` data-kp-confirm="${level} ${escHtml(row.label)}：${escHtml(row.summary)}，确认批准？"`
    : "";
  const deferAction = item.decision && !isNotification
    ? `<button class="b gh" data-kp-act="defer" data-action="inbox-defer" data-kp-defer="${escHtml(inboxKind)}:${id}">稍后 24h</button>`
    : "";
  const dataAttr = isMerge || item.kind === "failed" ? `data-flow="${id}"` : `data-id="${id}"`;
  const stage = item.kind === "merge"
    ? "人工门 #1"
    : item.kind === "proposal"
      ? "人工门 #2"
      : item.kind === "release"
        ? "发布"
        : item.kind === "connector"
          ? "connector"
          : isOpsGate
            ? "运营触发"
            : item.kind === "blocked"
              ? raised ? "等待回复" : "等待介入"
              : item.kind === "alert"
                ? "看门狗"
                : item.kind === "budget"
                  ? "预算告警"
                  : "失败";
  const actions = item.kind === "merge"
    ? `
          <button class="b ok" data-kp-act="approve"${confirmAttr} data-action="merge-main" data-flow="${id}" data-project="${projectId}">✓ 合并主干</button>
          <button class="b gh" data-kp-act="detail" data-action="gate-diff" data-flow="${id}" data-project="${projectId}">看改动</button>
          <button class="b gh" data-action="view" data-flow="${id}" data-project="${projectId}">查看</button>
          <button class="b dn" data-kp-act="reject" data-action="reject" data-flow="${id}" data-project="${projectId}">拒绝</button>
        `
    : item.kind === "proposal"
      ? `
          <button class="b pri" data-kp-act="approve"${confirmAttr} data-action="approve-apply" data-id="${id}" data-project="${projectId}">✓ 批准应用</button>
          <button class="b gh" data-action="edit" data-id="${id}" data-project="${projectId}">编辑</button>
          <button class="b dn" data-kp-act="reject" data-action="reject" data-id="${id}" data-project="${projectId}">拒绝</button>
        `
      : item.kind === "release"
        ? `
          <button class="b ok" data-kp-act="approve"${confirmAttr} data-action="confirm-release" data-id="${id}" data-project="${projectId}">✓ 确认发布</button>
          <button class="b dn" data-kp-act="reject" data-action="reject" data-id="${id}" data-project="${projectId}">拒绝</button>
        `
        : item.kind === "connector"
          ? `
          <button class="b pri" data-kp-act="approve"${confirmAttr} data-action="approve-connector" data-id="${id}" data-project="${projectId}">✓ 放行</button>
          <button class="b dn" data-kp-act="reject" data-action="reject" data-id="${id}" data-project="${projectId}">拒绝</button>
        `
          : isOpsGate
            ? `
          <button class="b ok" data-kp-act="approve"${confirmAttr} data-action="ops-gate-approve" data-id="${id}" data-project="${projectId}">批准并起跑</button>
          <button class="b dn" data-kp-act="reject" data-action="ops-gate-reject" data-id="${id}" data-project="${projectId}">驳回</button>
        `
            : raised
              ? `<textarea class="kp-reply" data-kp-reply-input="${id}" placeholder="回复 agent：给它缺的信息或决定"></textarea>
          <button class="b pri" data-action="reply-blocker" data-flow="${id}" data-project="${projectId}">回复并续跑</button>
          <button class="b gh" data-action="inbox-dismiss" data-kp-dismiss="blocked:${id}">忽略</button>`
              : item.kind === "failed" || item.kind === "blocked" || item.kind === "alert" || item.kind === "budget"
                ? `<button class="b gh" data-action="inbox-dismiss" data-kp-dismiss="${escHtml(item.kind)}:${id}">忽略</button>`
                : "";
  return `
    <div class='${gateClass({ kind: inboxKind, id: item.id }, seenKeys)}' data-kp-inbox-item data-kp-inbox-id="${escHtml(inboxKind)}:${id}"${hardGate ? ' data-kp-hard="1"' : ""}${isOpsGate ? ` data-ops-gate="${id}"` : ""} data-project="${projectId}" ${dataAttr}${owner ? ` data-kp-owner="${escHtml(owner)}"` : ""}>
      <div class="gate-h">
        <span class="tag">${projectName}</span>
        <div>
          <div class="ti">${title}</div>
          <div class="mt">${detail}</div>
        </div>
        <span class="stage impl">${escHtml(stage)}</span>
        ${row ? `<span class="tag" data-kp-blast="${level}" title="${escHtml(row.summary)}">${level} · ${escHtml(row.label)}</span>` : ""}
        ${owner ? `<span class="tag" data-kp-owner-tag>owner · ${escHtml(owner)}</span>` : ""}
        ${item.triage ? `<span class="tag" data-kp-origin="${escHtml(item.triage.origin)}" title="为什么到你这里">来由 · ${escHtml(originLabel(item.triage.origin))}</span><span class="tag" data-kp-trigger="${item.triage.triggeredBy}">${item.triage.triggeredBy === "ai" ? "AI 触发" : "规则触发"}</span>` : ""}
        ${hardGate ? '<span class="tag tag-warn">硬门·二次确认</span>' : ""}${item.decision?.expired ? '<span class="tag">已过期</span>' : ""}${item.decision?.absent ? '<span class="tag">缺席中</span>' : ""}
        ${isMerge ? `<span class="gate-diag" data-gate-diag="${id}"></span>` : ""}
      </div>
      <div class="gate-b">
        <div class="ruletxt">${detail}</div>
        ${evidence ? `<div class="ruletxt">证据：${escHtml(evidence)}</div>` : ""}
        ${item.triage ? `<div class="ruletxt" data-kp-confidence="${item.triage.confidence}">把握：${confidenceLabel(item.triage.confidence)}${item.triage.missing ? ` · 还缺：${escHtml(item.triage.missing)}` : ""}</div>` : ""}
        ${typeof costUsd === "number" && Number.isFinite(costUsd) ? `<div class="ruletxt">已花 $${costUsd.toFixed(2)}</div>` : ""}
        ${item.preReview ? `<div class="ruletxt" style="margin-top:7px">🤖 预审 <span class="tag ${item.preReview.verdict === "approve" ? "tag-ok" : item.preReview.verdict === "reject" ? "tag-danger" : "tag-warn"}">${item.preReview.verdict === "approve" ? "建议批准" : item.preReview.verdict === "reject" ? "建议拒绝" : "需细看"}</span> ${escHtml(item.preReview.reason)}</div>` : ""}
        ${actions || deferAction ? `<div class="acts">${actions}${deferAction}</div>` : ""}
      </div>
    </div>
  `;
}

export function sortReviewItemsByAttention(items: ReviewItem[]): ReviewItem[] {
  return reviewItemOrder(items);
}

/** 三栏：AI 建议放行 / 需要你判断 / 建议驳回；没算过 triage 的条目落「需要你判断」。 */
function renderQueueItems(items: ReviewItem[], seenKeys?: readonly string[]): string {
  const held = items.filter((item) => item.decision?.heldByCap).length;
  const visible = reviewItemOrder(items).filter((item) => !item.decision?.heldByCap);
  return groupByLane(visible)
    .map(({ lane, items: laneItems }) => `<div class="kp-lane" data-kp-lane="${lane.id}"><div class="ruletxt kp-lane-h" data-kp-lane-title>${lane.title} · ${laneItems.length}</div>${laneItems.map((item) => renderQueueItem(item, seenKeys)).join("")}</div>`)
    .join("")
    + (held > 0 ? `<div class="ruletxt" data-kp-held="${held}">今日限流：还有 ${held} 条硬门明日再看</div>` : "");
}

function renderOpsGate(gate: OpsGate, seenKeys?: readonly string[]): string {
  const id = escHtml(gate.id);
  const projectId = escHtml(gate.projectId);
  return `
    <div class='${gateClass({ kind: "ops", id: gate.id }, seenKeys)}' data-kp-inbox-item data-kp-inbox-id="ops:${id}" data-ops-gate="${id}" data-project="${projectId}">
      <div class="gate-h">
        <span class="tag tag-warn">运营门</span>
        <div>
          <div class="ti">${escHtml(gate.playbookId)}</div>
          <div class="mt">${escHtml(gate.reason)}</div>
        </div>
        <span class="stage impl">运营触发</span>
      </div>
      <div class="gate-b">
        <div class="ruletxt">${escHtml(gate.reason)}</div>
        <div class="acts">
          <button class="b ok" data-kp-act="approve" data-action="ops-gate-approve" data-id="${id}" data-project="${projectId}">批准并起跑</button>
          <button class="b dn" data-kp-act="reject" data-action="ops-gate-reject" data-id="${id}" data-project="${projectId}">驳回</button>
        </div>
      </div>
    </div>
  `;
}

function renderSection(title: string, count: number, body: string): string {
  return `
    <div class="section-h">
      <h3>${title}</h3>
      <span class="cnt">${count}</span>
    </div>
    ${body}
  `;
}

function renderAutopilotButton(count: number): string {
  if (count <= 0) return "";
  // 设计标准:禁 emoji 当图标 → 闪电用内联 SVG(Lucide zap)
  const zapIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>`;
  return `<div class="acts"><button class="b pri" data-action="autopilot">${zapIcon}一键自动合并全部</button></div>`;
}

export function renderReviewInbox(state: DashboardState): string {
  const queue = state.reviewQueue;
  if (queue) {
    const owners = reviewItemOwners(queue);
    const { until, note } = state.inboxPolicy?.absence ?? {};
    const absenceBanner = typeof until === "number" && until > Date.now()
      ? `<div class="lead" data-kp-absence>缺席模式至 ${escHtml(new Date(until).toLocaleString("zh-CN"))}：硬门不催、只攒；软门与通知照常。${note ? "（" + escHtml(note) + "）" : ""}</div>`
      : "";
    const merge = queue.filter((item) => item.kind === "merge");
    const proposals = queue.filter((item) => item.kind === "proposal");
    const releases = queue.filter((item) => item.kind === "release");
    const connectors = queue.filter((item) => item.kind === "connector");
    const opsGates = queue.filter((item) => item.kind === "ops-gate");
    const failed = queue.filter((item) => item.kind === "failed");
    const blocked = queue.filter((item) => item.kind === "blocked");
    const alerts = queue.filter((item) => item.kind === "alert");
    const budget = queue.filter((item) => item.kind === "budget");
    const total = queue.length;
    const body = total === 0
      ? `<div class="inbox-empty">暂无待处理的门 · 一切已拍板</div>`
      : [
          renderSection("合并确认", merge.length, renderAutopilotButton(merge.length) + renderQueueItems(merge, state.seenInboxKeys)),
          renderSection("进化提案批准", proposals.length, renderQueueItems(proposals, state.seenInboxKeys)),
          renderSection("发布确认", releases.length, renderQueueItems(releases, state.seenInboxKeys)),
          renderSection("高风险动作放行", connectors.length, renderQueueItems(connectors, state.seenInboxKeys)),
          renderSection("运营触发放行", opsGates.length, renderQueueItems(opsGates, state.seenInboxKeys)),
          renderSection("未恢复失败 · 待处理", failed.length, renderQueueItems(failed, state.seenInboxKeys)),
          renderSection("卡点 · 等待介入", blocked.length, renderQueueItems(blocked, state.seenInboxKeys)),
          renderSection("看门狗告警 · 卡死/长跑", alerts.length, renderQueueItems(alerts, state.seenInboxKeys)),
          renderSection("成本超预算", budget.length, renderQueueItems(budget, state.seenInboxKeys)),
        ].join("");

    return `
    <style>${inboxUnreadCss}${replyCss}</style>
    <div class="body">
      <div class="wrap inbox-wrap">
        <div class="section-h inbox-head">
          <h3>待我处理</h3>
          <span class="cnt">${total}</span>
          <span class="hint">控制门 · 四类人审一个入口</span>
        </div>
        <div class="lead"><span>合并确认、进化提案批准、发布确认和高风险 connector 放行集中在此。</span></div>
        ${owners.length > 0 ? `<label class="hint" data-kp-owner-filter-wrap>按 owner 筛：<select data-kp-owner-filter><option value="">全部</option>${owners.map((o) => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join("")}</select></label>` : ""}
        ${absenceBanner}${body}
      </div>
    </div>
  `;
  }

  const pendingOpsGates = (state.opsGates ?? []).filter((gate) => gate.status === "pending");
  const merge = state.humanGates.filter((g) => g.what.includes("合并"));
  const proposals = state.humanGates.filter((g) => g.what.includes("提案") || g.what.includes("进化"));
  const releases = (state.artifacts?.["release"] ?? []).filter((a) => a.status === "draft");
  const connectors = (state.artifacts?.["connector"] ?? []).filter((a) => a.status === "draft");
  const total = merge.length + proposals.length + releases.length + connectors.length + pendingOpsGates.length;
  const body = total === 0
    ? `<div class="inbox-empty">暂无待处理的门 · 一切已拍板</div>`
    : [
        renderSection("合并确认", merge.length, renderAutopilotButton(merge.length) + merge.map((gate) => renderMerge(gate, state.seenInboxKeys)).join("")),
        renderSection("进化提案批准", proposals.length, proposals.map((gate) => renderProposal(gate, state.seenInboxKeys)).join("")),
        renderSection("发布确认", releases.length, releases.map((item) => renderArtifact(item, "release", state.seenInboxKeys)).join("")),
        renderSection("高风险动作放行", connectors.length, connectors.map((item) => renderArtifact(item, "connector", state.seenInboxKeys)).join("")),
        renderSection("运营触发放行", pendingOpsGates.length, pendingOpsGates.map((gate) => renderOpsGate(gate, state.seenInboxKeys)).join("")),
      ].join("");

  return `
    <style>${inboxUnreadCss}${replyCss}</style>
    <div class="body">
      <div class="wrap inbox-wrap">
        <div class="section-h inbox-head">
          <h3>待我处理</h3>
          <span class="cnt">${total}</span>
          <span class="hint">控制门 · 四类人审一个入口</span>
        </div>
        <div class="lead"><span>合并确认、进化提案批准、发布确认和高风险 connector 放行集中在此。</span></div>
        ${body}
      </div>
    </div>
  `;
}
