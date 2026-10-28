export type StatusBadgeTone = "done" | "failed" | "needs-input" | "idle" | "running";

export interface StatusBadge {
  label: string;
  tone: StatusBadgeTone;
}

export interface VerdictCounts {
  gates: number;
  failed: number;
  running: number;
}

export interface HumanGateInput {
  flowId: string;
  what: string;
  detail: string;
  project?: string;
  preReview?: NeedsYouPrereview;
}

export interface FailureInput {
  flowId: string;
  requirement?: string;
  reason?: string;
  project?: string;
}

export interface BlockerInput {
  flowId: string;
  stage: string;
  reason: string;
  project?: string;
}

export interface NeedsYouInput {
  humanGates: HumanGateInput[];
  failures: FailureInput[];
  blockers: BlockerInput[];
}

export interface NeedsYouPrereview {
  verdict: string;
  reason: string;
}

export type NeedsYouTone = "needs-review" | "failed" | "needs-input";
export type NeedsYouKind = "gate" | "failed" | "blocked";

export interface NeedsYouItem {
  kind: NeedsYouKind;
  flowId: string;
  project?: string;
  title: string;
  detail: string;
  tone: NeedsYouTone;
  prereview?: NeedsYouPrereview;
}

export interface ProjectFlowInput {
  project: string;
  status: string;
}

export interface ProjectRollup {
  project: string;
  tone: "red" | "yellow" | "green";
  running: number;
}

export function statusBadge(rawStatus: string): StatusBadge {
  const status = rawStatus.toLowerCase();
  if (status.includes("verified")) {
    return { label: "已验", tone: "done" };
  }
  if (hasAny(status, ["roll", "fail", "crash"])) {
    return { label: "失败", tone: "failed" };
  }
  if (status.includes("block")) {
    return { label: "卡住", tone: "needs-input" };
  }
  if (hasAny(status, ["stop", "pause"])) {
    return { label: "暂停", tone: "idle" };
  }
  if (isRunningStatus(status)) {
    return { label: "在跑", tone: "running" };
  }
  return { label: rawStatus, tone: "running" };
}

export function buildVerdictLine({ gates, failed, running }: VerdictCounts): string {
  if (gates === 0 && failed === 0) {
    return `一切自动运行中,无需你介入（${running} 条流在跑）`;
  }

  const parts: string[] = [];
  if (gates > 0) {
    parts.push(`${gates} 条待你拍板`);
  }
  if (failed > 0) {
    parts.push(`${failed} 条失败需复盘`);
  }
  parts.push(`其余 ${running} 条自动运行中`);
  return parts.join(" · ");
}

export function buildNeedsYou(input: NeedsYouInput): NeedsYouItem[] {
  const gates = input.humanGates.map<NeedsYouItem>((gate) => ({
    kind: "gate",
    flowId: gate.flowId,
    project: gate.project,
    title: gate.what,
    detail: gate.detail,
    tone: "needs-review",
    ...(gate.preReview ? { prereview: gate.preReview } : {}),
  }));

  const failures = input.failures.map<NeedsYouItem>((failure) => ({
    kind: "failed",
    flowId: failure.flowId,
    project: failure.project,
    title: failure.requirement ?? failure.flowId,
    detail: failure.reason ?? "",
    tone: "failed",
  }));

  const blockers = input.blockers.map<NeedsYouItem>((blocker) => ({
    kind: "blocked",
    flowId: blocker.flowId,
    project: blocker.project,
    title: blocker.flowId,
    detail: `${blocker.stage}: ${blocker.reason}`,
    tone: "needs-input",
  }));

  return [...gates, ...failures, ...blockers];
}

export function buildProjectRollup(flows: ProjectFlowInput[]): ProjectRollup[] {
  const byProject = new Map<string, ProjectFlowInput[]>();
  for (const flow of flows) {
    byProject.set(flow.project, [...(byProject.get(flow.project) ?? []), flow]);
  }

  return [...byProject.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([project, projectFlows]) => {
      const statuses = projectFlows.map((flow) => flow.status.toLowerCase());
      const tone = projectTone(statuses);
      const running = statuses.filter(isRunningStatus).length;
      return { project, tone, running };
    });
}

function projectTone(statuses: string[]): ProjectRollup["tone"] {
  if (statuses.some((status) => hasAny(status, ["roll", "fail", "crash"]))) {
    return "red";
  }
  if (statuses.some((status) => status.includes("block"))) {
    return "yellow";
  }
  return "green";
}

function isRunningStatus(status: string): boolean {
  return hasAny(status, ["running", "implement", "verify", "spec"]);
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
