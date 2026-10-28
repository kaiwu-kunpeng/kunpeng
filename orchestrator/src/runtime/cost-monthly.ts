import { isRecord } from "../util/is-record.js";
import { estimateCostUsd } from "./cost-pricing.js";

export interface MonthlyCostRow {
  month: string;
  model: string;
  tokens: number;
  usd: number;
}

interface MonthlyCostFlow {
  updatedAt?: number;
  stageTokens?: Record<string, number>;
  stageModels?: Record<string, string>;
  stageBackends?: Record<string, string>;
  backend?: string;
}

function tokenEntries(value: unknown): [string, number][] {
  if (!isRecord(value)) return [];
  return Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number");
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function stageLabel(flow: MonthlyCostFlow, stage: string): string {
  return stringField(flow.stageModels, stage) ?? stringField(flow.stageBackends, stage) ?? (typeof flow.backend === "string" ? flow.backend : undefined) ?? "unknown";
}

function monthFromUpdatedAt(updatedAt: number | undefined): string | undefined {
  if (updatedAt === undefined || !Number.isFinite(updatedAt)) return undefined;
  const date = new Date(updatedAt);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toISOString().slice(0, 7);
}

export function buildMonthlyCostReport(flows: MonthlyCostFlow[]): MonthlyCostRow[] {
  const grouped = new Map<string, Map<string, number>>();

  for (const rawFlow of flows as unknown[]) {
    if (!isRecord(rawFlow)) continue;
    const flow = rawFlow as MonthlyCostFlow;
    const month = monthFromUpdatedAt(flow.updatedAt);
    if (month === undefined) continue;

    for (const [stage, tokens] of tokenEntries(flow.stageTokens)) {
      if (!Number.isFinite(tokens) || tokens < 0) continue;
      const model = stageLabel(flow, stage);
      const models = grouped.get(month) ?? new Map<string, number>();
      models.set(model, (models.get(model) ?? 0) + tokens);
      grouped.set(month, models);
    }
  }

  const rows: MonthlyCostRow[] = [];
  for (const [month, models] of grouped.entries()) {
    for (const [model, tokens] of models.entries()) {
      rows.push({ month, model, tokens, usd: estimateCostUsd({ [model]: tokens }).totalUsd });
    }
  }

  return rows.sort((left, right) => {
    const monthOrder = right.month.localeCompare(left.month);
    if (monthOrder !== 0) return monthOrder;
    const tokenOrder = right.tokens - left.tokens;
    if (tokenOrder !== 0) return tokenOrder;
    return left.model.localeCompare(right.model);
  });
}
