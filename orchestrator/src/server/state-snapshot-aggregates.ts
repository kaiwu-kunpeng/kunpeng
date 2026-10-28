// 跨项目快照聚合的纯函数（从 state.ts 巨石析出：把各项目 snapshot 的 loops/gates/blockers 等汇成全局视图）。
// 均为无外部 helper 依赖的纯函数；类型走 type-only import（运行时擦除，不成环）。
import { relTime } from "../util/rel-time.js";
import { triageReviewItem } from "./inbox-triage.js";
import { isRaiseBlocker } from "../runtime/raise-blocker.js";
import { classifyActionLevel, isActionLevel, isHardGateLevel, levelPriority } from "../policy/action-levels.js";
import { DEFAULT_INBOX_POLICY, type InboxPolicy } from "./inbox-policy.js";
import type { PlaybookDef } from "../loop/playbook.js";
import type { OpsGateEntry } from "../loop/ops-gate.js";
import type {
  ProjectSnapshot,
  LoopView,
  OpsReport,
  FlowWithLight,
  DashboardState,
  ReviewItem,
  QualityGateStats,
  ProjectActivity,
  ActivityTruth,
} from "./state.js";

const FAILED_FLOW_STATUSES = new Set(["crashed", "stopped"]);
export const STALE_FAILED_FLOW_MS = 7 * 24 * 60 * 60 * 1000;

/** 总览底座：列表跨项目拼接、计数求和，系统灯取最坏。 */
export function aggregateOverviewBase(snapshots: readonly ProjectSnapshot[]): Pick<DashboardState,
  "flows" | "flowsTotal" | "statusCounts" | "plans" | "plansTotal" | "code" | "health" | "systemLight" | "reinjectBacklog" | "artifactsTotal"
> {
  const flows: DashboardState["flows"] = [];
  const plans: DashboardState["plans"] = [];
  const statusCounts: DashboardState["statusCounts"] = {};
  const code: DashboardState["code"] = {
    srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0,
  };
  const health: DashboardState["health"] = { alerts: [], running: 0, healthy: 0 };
  let flowsTotal = 0;
  let plansTotal = 0;
  let systemLight: DashboardState["systemLight"] = "green";
  let reinjectBacklog: DashboardState["reinjectBacklog"];
  let artifactsTotal: DashboardState["artifactsTotal"];

  for (const { id, name, state } of snapshots) {
    const project = { id, name };
    flows.push(...state.flows.map((flow) => ({ ...flow, project: flow.project ?? project })));
    flowsTotal += state.flowsTotal ?? state.flows.length;
    plans.push(...state.plans);
    plansTotal += state.plansTotal ?? state.plans.length;
    for (const [status, count] of Object.entries(state.statusCounts)) {
      statusCounts[status] = (statusCounts[status] ?? 0) + count;
    }
    code.srcLines += state.code.srcLines;
    code.testLines += state.code.testLines;
    code.passedLines += state.code.passedLines;
    code.inFlightLines += state.code.inFlightLines;
    code.completed += state.code.completed;
    code.running += state.code.running;
    code.rolledBack += state.code.rolledBack;
    health.alerts.push(...state.health.alerts.map((alert) =>
      alert !== null && typeof alert === "object" && !("project" in alert)
        ? { ...alert, project }
        : alert,
    ));
    health.running += state.health.running;
    health.healthy += state.health.healthy;
    if (state.systemLight === "red" || (state.systemLight === "yellow" && systemLight === "green")) {
      systemLight = state.systemLight;
    }
    if (state.reinjectBacklog !== undefined) {
      reinjectBacklog ??= { pending: 0 };
      reinjectBacklog.pending += state.reinjectBacklog.pending;
    }
    if (state.artifactsTotal !== undefined) {
      artifactsTotal ??= {};
      for (const [kind, count] of Object.entries(state.artifactsTotal)) {
        artifactsTotal[kind] = (artifactsTotal[kind] ?? 0) + count;
      }
    }
  }

  return {
    flows: flows.sort((a, b) => b.updatedAt - a.updatedAt),
    flowsTotal, statusCounts, plans, plansTotal, code, health, systemLight, reinjectBacklog, artifactsTotal,
  };
}

/** 多项目模式下把各项目 .kunpeng/loops 的 loop 汇成全局「运营 loop」视图（每个 loop 自带 name 标识其归属）。 */
export function aggregateLoops(snapshots: ProjectSnapshot[]): LoopView[] {
  return snapshots.flatMap((snapshot) =>
    (snapshot.state.loops ?? []).map((loop) => ({ ...loop, projectId: loop.projectId ?? snapshot.id })),
  );
}

export function aggregatePlaybooks(snapshots: ProjectSnapshot[]): PlaybookDef[] {
  return snapshots.flatMap((snapshot) =>
    (snapshot.state.playbooks ?? []).map((playbook) => ({ ...playbook, projectId: playbook.projectId ?? snapshot.id })),
  );
}

export function aggregateOpsGates(snapshots: ProjectSnapshot[]): OpsGateEntry[] {
  return snapshots.flatMap((snapshot) =>
    (snapshot.state.opsGates ?? []).map((gate) => ({ ...gate, projectId: gate.projectId || snapshot.id })),
  );
}

export function aggregateHumanGates(snapshots: ProjectSnapshot[]): DashboardState["humanGates"] {
  return snapshots.flatMap((snapshot) => snapshot.state.humanGates ?? []);
}

export function aggregateBlockers(snapshots: ProjectSnapshot[]): DashboardState["blockers"] {
  return snapshots.flatMap((snapshot) => snapshot.state.blockers ?? []);
}

export function aggregateOpsReports(snapshots: ProjectSnapshot[]): OpsReport[] {
  return snapshots.flatMap((snapshot) =>
    (snapshot.state.opsReports ?? []).map((report) => ({ ...report, projectId: report.projectId ?? snapshot.id })),
  );
}

export function aggregateCrossProjectRunning(snapshots: ProjectSnapshot[]): FlowWithLight[] {
  const all: FlowWithLight[] = [];
  for (const snapshot of snapshots) {
    for (const flow of snapshot.state.running) {
      all.push({ ...flow, project: { id: snapshot.id, name: snapshot.name } });
    }
  }
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

export function isHardGate(item: ReviewItem): boolean {
  return isHardGateLevel(item.decision?.blastRadius);
}

function attentionPriority(item: ReviewItem): number {
  switch (item.preReview?.verdict) {
    case "reject":
      return 0;
    case "review":
      return 1;
    case "approve":
      return 3;
    default:
      return 2;
  }
}

function blastRadiusPriority(item: ReviewItem): number {
  return item.decision ? Math.min(levelPriority(item.decision.blastRadius), 2) : 3;
}

export function reviewItemOrder(items: ReviewItem[]): ReviewItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) =>
      blastRadiusPriority(left.item) - blastRadiusPriority(right.item) ||
      attentionPriority(left.item) - attentionPriority(right.item) ||
      Number(!!left.item.decision?.expired) - Number(!!right.item.decision?.expired) ||
      left.index - right.index)
    .map(({ item }) => item);
}

export function countActionableGates(items: ReviewItem[]): number {
  return items.filter((item) => !item.decision || (!item.decision.expired && !item.decision.heldByCap)).length;
}

export function reviewItemOwners(items: ReviewItem[]): string[] {
  return [...new Set(items.map((item) => item.decision?.owner)
    .filter((owner): owner is string => typeof owner === "string" && owner.length > 0))]
    .sort((a, b) => a.localeCompare(b));
}

export function aggregateReviewQueue(snapshots: ProjectSnapshot[], opts?: { now?: number; dismissed?: Set<string>; deferred?: Set<string>; policy?: InboxPolicy }): ReviewItem[] {
  const policy = opts?.policy ?? DEFAULT_INBOX_POLICY;
  const ttlMs = policy.gateTtlHours * 3_600_000;
  const items: ReviewItem[] = [];
  const ruleIdsByItem = new WeakMap<ReviewItem, readonly string[]>();
  for (const snapshot of snapshots) {
    const ownerByGoal = new Map((snapshot.state.goals ?? []).map((g) => [g.id, g.owner] as const));
    const project = { projectId: snapshot.id, projectName: snapshot.name };
    const humanGates = snapshot.state.humanGates ?? [];

    for (const gate of humanGates) {
      if (gate.what.includes("合并")) {
        const flow = (snapshot.state.flows ?? []).find((f) => f.flowId === gate.flowId);
        const owner = flow?.goalId ? ownerByGoal.get(flow.goalId) : undefined;
        const evidence = flow
          ? [...(flow.mergeTier?.reasons ?? []), typeof flow.changedFileCount === "number" ? `改动 ${flow.changedFileCount} 个文件` : ""].filter(Boolean).join("；") || undefined
          : undefined;
        const reasoning = gate.preReview?.reason;
        const costUsd = flow?.budget?.spentUsd;
        items.push({
          ...project, kind: "merge", id: gate.flowId, title: gate.what, detail: gate.detail, preReview: gate.preReview,
          decision: flow ? {
            action: "merge-main",
            blastRadius: classifyActionLevel({ externallyVisible: flow.mergeTier?.tier === "human", reversible: true }),
            ...(evidence !== undefined ? { evidence } : {}),
            ...(reasoning !== undefined ? { reasoning } : {}),
            ...(costUsd !== undefined ? { costUsd } : {}),
            ...(owner !== undefined ? { owner } : {}),
            ...(typeof flow.gateOpenedAt === "number" && Number.isFinite(flow.gateOpenedAt)
              ? { expiresAt: flow.gateOpenedAt + ttlMs } : {}),
          } : { action: "merge-main", blastRadius: classifyActionLevel({}) },
        });
        if (flow?.mergeTier?.ruleIds?.length) ruleIdsByItem.set(items[items.length - 1]!, flow.mergeTier.ruleIds);
      }
    }
    for (const gate of humanGates) {
      if (gate.what.includes("提案") || gate.what.includes("进化")) {
        const reasoning = gate.preReview?.reason;
        items.push({
          ...project, kind: "proposal", id: gate.flowId, title: gate.what, detail: gate.detail, preReview: gate.preReview,
          decision: { action: "approve-apply", blastRadius: classifyActionLevel({ externallyVisible: true, reversible: true }), ...(reasoning !== undefined ? { reasoning } : {}) },
        });
      }
    }
    for (const artifact of snapshot.state.artifacts?.["release"] ?? []) {
      if (artifact.status === "draft") {
        items.push({
          ...project, kind: "release", id: artifact.id, title: artifact.id, detail: artifact.summary, preReview: artifact.preReview,
          decision: { action: "confirm-release", blastRadius: classifyActionLevel({ externallyVisible: true, reversible: false }), evidence: artifact.summary },
        });
      }
    }
    for (const artifact of snapshot.state.artifacts?.["connector"] ?? []) {
      if (artifact.status === "draft") {
        items.push({
          ...project, kind: "connector", id: artifact.id, title: artifact.id, detail: artifact.summary, preReview: artifact.preReview,
          decision: { action: "approve-connector", blastRadius: classifyActionLevel({ thirdPartyAuth: true, reversible: true }), evidence: artifact.summary },
        });
      }
    }
    for (const gate of (snapshot.state.opsGates ?? []).filter((g) => g.status === "pending")) {
      const goalId = snapshot.state.loops?.find((l) => l.id === gate.loopId)?.goalId;
      const owner = goalId ? ownerByGoal.get(goalId) : undefined;
      items.push({
        ...project, kind: "ops-gate", id: gate.id, title: gate.playbookId, detail: gate.reason,
        // 等级取运营 loop 杠杆的最高等级（action-levels 单一来源）；旧门没记等级时按「对外可见但可逆」软门保守处理。
        decision: { action: "ops-gate-approve", blastRadius: isActionLevel(gate.level) ? gate.level : classifyActionLevel({ externallyVisible: true, reversible: true }), evidence: `loop ${gate.loopId}`, expiresAt: gate.createdAt + ttlMs, ...(owner !== undefined ? { owner } : {}) },
      });
    }
    const failedFlows = [...(snapshot.state.flows ?? [])]
      .filter((flow) => FAILED_FLOW_STATUSES.has(flow.status))
      .filter((flow) => !isRaiseBlocker(flow.blocker))
      .filter((flow) => {
        const now = opts?.now;
        if (typeof now !== "number" || !Number.isFinite(now)) return true;
        if (typeof flow.updatedAt !== "number" || !Number.isFinite(flow.updatedAt)) return true;
        return now - flow.updatedAt <= STALE_FAILED_FLOW_MS;
      })
      .sort((a, b) => (Number.isFinite(b.updatedAt) ? b.updatedAt : 0) - (Number.isFinite(a.updatedAt) ? a.updatedAt : 0))
      .slice(0, 10);
    for (const flow of failedFlows) {
      const reason = flow.failureReason || flow.blocker;
      items.push({
        ...project,
        kind: "failed",
        id: flow.flowId,
        title: flow.requirement || flow.flowId,
        detail: flow.status + (reason ? ` · ${reason}` : ""),
      });
    }
    for (const blocker of (snapshot.state.blockers ?? []).slice(0, 10)) {
      items.push({
        ...project,
        kind: "blocked",
        id: blocker.flowId,
        title: blocker.reason || blocker.flowId,
        detail: `阶段 ${blocker.stage}`,
      });
    }
    for (const alert of (snapshot.state.health?.alerts ?? []).slice(0, 10)) {
      items.push({
        ...project,
        kind: "alert",
        id: alert.flowId,
        title: `${alert.kind === "stuck" ? "卡死" : "长跑"} · ${alert.flowId}`,
        detail: `阶段 ${alert.stage} · 已 ${Math.round(alert.ageMs / 60000)} 分钟`,
      });
    }
  }
  const queue = items.filter((item) => {
    if (item.kind !== "failed" && item.kind !== "blocked" && item.kind !== "alert") return true;
    return !opts?.dismissed?.has(`${item.kind}:${item.id}`);
  }).filter((item) => {
    const inboxKind = item.kind === "ops-gate" ? "ops" : item.kind;
    return !opts?.deferred?.has(`${inboxKind}:${item.id}`);
  });
  const now = opts?.now;
  if (typeof now === "number" && Number.isFinite(now)) {
    for (const item of queue) {
      if (!item.decision) continue;
      if (item.decision.expiresAt !== undefined && now > item.decision.expiresAt) item.decision.expired = true;
      if (typeof policy.absence?.until === "number" && policy.absence.until > now && isHardGate(item)) {
        item.decision.absent = true;
      }
    }
  }
  const hardCounts = new Map<string, number>();
  for (const item of reviewItemOrder(queue)) {
    if (!isHardGate(item) || !item.decision || item.decision.expired) continue;
    const count = (hardCounts.get(item.projectId) ?? 0) + 1;
    hardCounts.set(item.projectId, count);
    if (count > policy.dailyHardCapPerProject) item.decision.heldByCap = true;
  }
  for (const item of queue) item.triage = triageReviewItem(item, { ruleIds: ruleIdsByItem.get(item) });
  return queue;
}

export function aggregateQualityGateStats(snapshots: ProjectSnapshot[]): QualityGateStats {
  const stats = snapshots.map((snapshot) => snapshot.state.qualityGateStats);

  const verified30d: QualityGateStats["verified30d"] = stats.some(
    (item) => item === undefined || item.verified30d.status === "error",
  )
    ? { status: "error" }
    : {
        status: "ok",
        verified: stats.reduce((sum, item) => sum + (item?.verified30d.status === "ok" ? item.verified30d.verified : 0), 0),
        total: stats.reduce((sum, item) => sum + (item?.verified30d.status === "ok" ? item.verified30d.total : 0), 0),
      };

  let failures7d: QualityGateStats["failures7d"] = { status: "error" };
  if (!stats.some((item) => item === undefined || item.failures7d.status === "error")) {
    const patterns = new Map<string, { count: number; order: number }>();
    let order = 0;
    let count = 0;
    for (const item of stats) {
      if (item?.failures7d.status !== "ok") continue;
      count += item.failures7d.count;
      for (const pattern of item.failures7d.patterns) {
        const existing = patterns.get(pattern.signature);
        if (existing) existing.count += pattern.count;
        else patterns.set(pattern.signature, { count: pattern.count, order: order++ });
      }
    }
    failures7d = {
      status: "ok",
      count,
      patterns: [...patterns.entries()]
        .sort(([, left], [, right]) => right.count - left.count || left.order - right.order)
        .map(([signature, value]) => ({ signature, count: value.count })),
    };
  }

  const rolledBackTotal: QualityGateStats["rolledBackTotal"] = stats.some(
    (item) => item === undefined || item.rolledBackTotal.status === "error",
  )
    ? { status: "error" }
    : {
        status: "ok",
        count: stats.reduce((sum, item) => sum + (item?.rolledBackTotal.status === "ok" ? item.rolledBackTotal.count : 0), 0),
      };

  return { verified30d, failures7d, rolledBackTotal };
}

export function buildActivityByProject(snapshots: ProjectSnapshot[], now: number): ProjectActivity[] {
  return snapshots
    .map((snapshot) => {
      const flows = snapshot.state.flows;
      const recent = [...flows]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 4)
        .map((flow) => ({
          flowId: flow.flowId,
          status: flow.status,
          stage: flow.stage,
          updatedAt: flow.updatedAt,
          agoText: relTime(now - flow.updatedAt),
        }));
      const activity = snapshot.state.activity;
      if (activity) {
        return {
          id: snapshot.id,
          name: snapshot.name,
          total: activity.total,
          verified: activity.verified,
          rolledBack: activity.rolledBack,
          successRate: activity.successRate,
          recent,
        };
      }

      const verified = flows.filter((flow) => flow.status === "verified").length;
      const rolledBack = flows.filter((flow) => flow.status === "rolled-back").length;
      const finished = verified + rolledBack;
      return {
        id: snapshot.id,
        name: snapshot.name,
        total: flows.length,
        verified,
        rolledBack,
        successRate: finished === 0 ? 1 : verified / finished,
        recent,
      };
    })
    .sort((a, b) => {
      const aLatest = a.recent[0]?.updatedAt;
      const bLatest = b.recent[0]?.updatedAt;
      if (aLatest !== undefined && bLatest !== undefined && aLatest !== bLatest) return bLatest - aLatest;
      if (aLatest !== undefined && bLatest === undefined) return -1;
      if (aLatest === undefined && bLatest !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });
}

export function aggregateCrossProjectActivity(snapshots: ProjectSnapshot[], now: number): ActivityTruth {
  let total = 0;
  let verified = 0;
  let rolledBack = 0;
  const recent: ActivityTruth["recent"] = [];

  for (const snapshot of snapshots) {
    const activity = snapshot.state.activity;
    if (activity) {
      total += activity.total;
      verified += activity.verified;
      rolledBack += activity.rolledBack;
    }
    for (const flow of snapshot.state.flows) {
      recent.push({
        flowId: flow.flowId,
        status: flow.status,
        stage: flow.stage,
        updatedAt: flow.updatedAt,
        agoText: relTime(now - flow.updatedAt),
        project: { id: snapshot.id, name: snapshot.name },
      });
    }
  }

  const finished = verified + rolledBack;
  return {
    total,
    verified,
    rolledBack,
    successRate: finished === 0 ? 1 : verified / finished,
    recent: recent.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8),
  };
}
