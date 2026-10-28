export interface ReplayTaskOutcome {
  id: string;
  acceptanceCmd: string;
  baselinePassed: boolean;
  candidatePassed: boolean;
  ms: number;
}

export interface ReplayResult {
  baselinePassK: number;
  candidatePassK: number;
  pairedDelta?: number;
  pairedStdError?: number;
  discernible?: boolean;
  costPerResolvedTask: number;
  tasks: ReplayTaskOutcome[];
  measuredAt?: number;
}

export interface EvalReportMeta {
  proposalId?: string;
  proposalTitle?: string;
  repeatCmd?: string;
  generatedAt?: number;
}

export interface EvalReport {
  delta: number;
  improved: boolean;
  baselinePassK: number;
  candidatePassK: number;
  costPerResolvedTask: number;
  taskCount: number;
  passedCount: number;
  markdown: string;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${percent(Math.abs(value))}`;
}

function passLabel(passed: boolean): string {
  return passed ? "通过" : "未通过";
}

function renderTaskRows(tasks: ReplayTaskOutcome[]): string[] {
  if (tasks.length === 0) {
    return ["（无任务明细：holdout 为空）"];
  }

  return [
    "| 任务 | 基线 | 候选 | 耗时(ms) | 重跑命令 |",
    "| --- | --- | --- | ---: | --- |",
    ...tasks.map((task) => (
      `| ${task.id} | ${passLabel(task.baselinePassed)} | ${passLabel(task.candidatePassed)} | ${task.ms} | ${task.acceptanceCmd} |`
    )),
  ];
}

export function renderEvalReport(replay: ReplayResult, meta?: EvalReportMeta): EvalReport {
  const delta = replay.candidatePassK - replay.baselinePassK;
  const improved = delta > 0;
  const taskCount = replay.tasks.length;
  const passedCount = replay.tasks.filter((task) => task.candidatePassed).length;
  const pairedSummary = replay.pairedDelta === undefined
    ? []
    : [
      `配对 delta: ${signedPercent(replay.pairedDelta)} (${replay.pairedDelta}) ±标准误: ${replay.pairedStdError ?? 0}`,
      `配对判定: ${replay.discernible ? "与噪声可区分" : "落在噪声内"}`,
    ];

  const lines = [
    `# 自我进化·可复现报告${meta?.proposalTitle ? ` — ${meta.proposalTitle}` : ""}`,
    "",
  ];

  if (meta?.proposalId) {
    lines.push(`提案: ${meta.proposalId}`);
  }

  if (meta?.generatedAt !== undefined) {
    lines.push(`生成时间: ${meta.generatedAt}`);
  }

  lines.push(
    "",
    "## 概要",
    `提案前通过率: ${percent(replay.baselinePassK)}`,
    `提案后通过率: ${percent(replay.candidatePassK)}`,
    `delta: ${signedPercent(delta)} (${delta})`,
    `是否改进: ${improved ? "是" : "否"}`,
    ...pairedSummary,
    `costPerResolvedTask: ${replay.costPerResolvedTask}`,
    `任务数: ${taskCount}`,
    `候选通过数: ${passedCount}`,
    "",
    "## 每任务明细",
    ...renderTaskRows(replay.tasks),
    "",
    "## 可重跑命令",
  );

  if (meta?.repeatCmd) {
    lines.push("```sh", meta.repeatCmd, "```");
  } else {
    lines.push("未提供重跑命令");
  }

  return {
    delta,
    improved,
    baselinePassK: replay.baselinePassK,
    candidatePassK: replay.candidatePassK,
    costPerResolvedTask: replay.costPerResolvedTask,
    taskCount,
    passedCount,
    markdown: lines.join("\n"),
  };
}
