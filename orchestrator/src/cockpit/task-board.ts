import type { AutomationLevel } from "../metrics/automation-level.js";
import { clip, fmtTokens, relTime, stripMd } from "../server/ui/fmt.js";

export interface TaskBoardFlow {
  id: string;
  requirement: string;
  status: string;
  project: string;
  model: string;
  tokens: number;
  cacheReadTokens?: number;
  costUsd: number;
  level?: AutomationLevel;
  ageMs: number;
  updatedAt?: number;
}

export interface TaskBoardRow {
  id: string;
  requirement: string;
  status: string;
  project: string;
  model: string;
  tokens: string;
  rawTokens: string;
  cacheReadTokens?: number;
  cost: string;
  level: AutomationLevel | "—";
  age: string;
  rawRequirement: string;
}

export interface TaskBoardSummary {
  total: number;
  byStatus: Record<string, number>;
  byLevel: Record<string, number>;
  totalCostUsd: number;
}

export interface TaskBoard {
  rows: TaskBoardRow[];
  summary: TaskBoardSummary;
}

export function buildTaskBoard(
  flows: TaskBoardFlow[],
  opts?: { sortBy?: "tokens" | "age" | "status" },
): TaskBoard {
  const sortBy = opts?.sortBy ?? "age";
  const rows = [...flows].sort((a, b) => compareFlows(a, b, sortBy)).map(toRow);
  const summary = flows.reduce<TaskBoardSummary>(
    (acc, flow) => {
      const level = flow.level ?? "—";
      acc.total += 1;
      acc.byStatus[flow.status] = (acc.byStatus[flow.status] ?? 0) + 1;
      acc.byLevel[level] = (acc.byLevel[level] ?? 0) + 1;
      acc.totalCostUsd += flow.costUsd;
      return acc;
    },
    { total: 0, byStatus: {}, byLevel: {}, totalCostUsd: 0 },
  );

  return { rows, summary };
}

function toRow(flow: TaskBoardFlow): TaskBoardRow {
  const tokens = Number.isFinite(flow.tokens) ? flow.tokens : 0;
  const costUsd = Number.isFinite(flow.costUsd) ? flow.costUsd : 0;
  const updatedAt = typeof flow.updatedAt === "number" && Number.isFinite(flow.updatedAt)
    ? flow.updatedAt
    : undefined;

  return {
    id: flow.id ?? "",
    requirement: clip(stripMd(flow.requirement), 64),
    rawRequirement: flow.requirement,
    status: flow.status,
    project: flow.project ?? "—",
    model: flow.model ?? "—",
    tokens: fmtTokens(tokens),
    rawTokens: String(tokens),
    ...(flow.cacheReadTokens !== undefined ? { cacheReadTokens: flow.cacheReadTokens } : {}),
    cost: `$${costUsd.toFixed(4)}`,
    level: flow.level ?? "—",
    age: updatedAt === undefined ? formatAge(flow.ageMs ?? 0) : relTime(updatedAt),
  };
}

function compareFlows(
  a: TaskBoardFlow,
  b: TaskBoardFlow,
  sortBy: "tokens" | "age" | "status",
): number {
  if (sortBy === "tokens") {
    return b.tokens - a.tokens || a.id.localeCompare(b.id);
  }
  if (sortBy === "status") {
    return a.status.localeCompare(b.status) || a.id.localeCompare(b.id);
  }
  return a.ageMs - b.ageMs || a.id.localeCompare(b.id);
}

function formatAge(ageMs: number): string {
  if (ageMs < 60_000) {
    return "<1m";
  }
  if (ageMs < 3_600_000) {
    return `${Math.floor(ageMs / 60_000)}m`;
  }
  return `${Math.floor(ageMs / 3_600_000)}h`;
}
