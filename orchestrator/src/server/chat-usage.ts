import { estimateUsageCostUsd } from "../runtime/cost-pricing.js";
import type { BilledUsage } from "../runtime/billed-tokens.js";

export interface ChatUsage extends BilledUsage { model?: string }

interface TimingInterval {
  start: number;
  end: number;
}

export interface TimingAgg {
  openIntervals: Array<{ start: number; toolId?: string }>;
  closedIntervals: TimingInterval[];
  turns: number;
}

export function createTimingAgg(): TimingAgg {
  return { openIntervals: [], closedIntervals: [], turns: 0 };
}

export function timingAggFeed(
  agg: TimingAgg,
  ev: { kind: "toolUse" | "toolResult" | "text"; at: number; toolId?: string },
): void {
  if (ev.kind === "text") return;

  const at = finiteNonNegative(ev.at);
  if (ev.kind === "toolUse") {
    agg.openIntervals.push({ start: at, ...(ev.toolId === undefined ? {} : { toolId: ev.toolId }) });
    agg.turns += 1;
    return;
  }

  const openIndex = agg.openIntervals.findIndex((interval) => interval.toolId === ev.toolId);
  if (openIndex < 0) return;
  const [open] = agg.openIntervals.splice(openIndex, 1);
  if (!open) return;
  agg.closedIntervals.push({ start: open.start, end: Math.max(open.start, at) });
}

export function timingAggFinish(
  agg: TimingAgg,
  totalMs: number,
): { toolMs: number; modelMs: number; turns: number } {
  const total = finiteNonNegative(totalMs);
  const intervals = [
    ...agg.closedIntervals,
    ...agg.openIntervals.map((interval) => ({ start: interval.start, end: total })),
  ]
    .map(({ start, end }) => ({
      start: Math.min(total, finiteNonNegative(start)),
      end: Math.min(total, Math.max(finiteNonNegative(start), finiteNonNegative(end))),
    }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let toolMs = 0;
  let mergedStart: number | undefined;
  let mergedEnd = 0;
  for (const interval of intervals) {
    if (mergedStart === undefined) {
      mergedStart = interval.start;
      mergedEnd = interval.end;
      continue;
    }
    if (interval.start <= mergedEnd) {
      mergedEnd = Math.max(mergedEnd, interval.end);
      continue;
    }
    toolMs += mergedEnd - mergedStart;
    mergedStart = interval.start;
    mergedEnd = interval.end;
  }
  if (mergedStart !== undefined) toolMs += mergedEnd - mergedStart;

  return { toolMs, modelMs: Math.max(0, total - toolMs), turns: agg.turns };
}

/** codex 的 usage 不带 model;缺省时用本轮对话模型补上,否则会话累计 / 按模型用量聚合会按 unknown 兜底价算。显式 model 优先。 */
export function usageWithModel<T extends ChatUsage>(usage: T, fallbackModel: string): T & { model: string } {
  const model = usage.model?.trim() || fallbackModel.trim() || "unknown";
  return { ...usage, model };
}

/** 纯函数:把单轮 chat/driver usage 格式化为用量行内容(纯文本,不含 HTML 标签;调用方负责 escape+包 span)。 */
export function formatChatUsageLine(
  usage: ChatUsage,
  fallbackModel?: string,
  sessionUsd?: number,
  timing?: { firstTokenMs?: number; totalMs?: number; toolMs?: number; turns?: number },
): string {
  const input = positiveRoundedToken(usage.input);
  const output = positiveRoundedToken(usage.output);
  const model = (usage.model?.trim() || fallbackModel?.trim()) || "unknown";
  const usd = estimateUsageCostUsd(usage, model).toFixed(4);
  const sessionTotal = typeof sessionUsd === "number" && Number.isFinite(sessionUsd)
    ? ` · 会话累计 $${sessionUsd.toFixed(4)}`
    : "";
  const firstToken = timing?.firstTokenMs !== undefined
    ? ` · 首字 ${(timing.firstTokenMs / 1000).toFixed(1)}s`
    : "";
  const hasTools = timing?.turns !== undefined && timing.turns > 0 && timing.toolMs !== undefined;
  const toolSummary = hasTools
    ? `(工具 ${(timing.toolMs! / 1000).toFixed(1)}s/${Math.round(timing.turns!)}次)`
    : "";
  const total = timing?.totalMs !== undefined
    ? `${hasTools ? (firstToken ? " ｜ " : " · ") : " / "}总 ${(timing.totalMs / 1000).toFixed(1)}s${toolSummary}`
    : "";
    const cr = positiveRoundedToken(usage.cacheRead);
  const cc = positiveRoundedToken(usage.cacheCreate);
  const cacheSeg = (cr || cc) ? ` (cache${cr ? " 读" + cr : ""}${cc ? " 写" + cc : ""})` : "";
  return `in ${input} / out ${output}${cacheSeg} · ${model} · $${usd}${sessionTotal}${firstToken}${total}`;
}

export function sumConversationUsd(
  turns: Array<{ usage?: { input?: number; output?: number; cacheCreate?: number; cacheRead?: number; model?: string } }>,
): number {
  return turns.reduce((total, turn) => {
    if (!turn.usage) return total;
    const model = turn.usage.model?.trim() || "unknown";
    return total + estimateUsageCostUsd(turn.usage, model);
  }, 0);
}

function positiveRoundedToken(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
