/** 本地 span 树：每条流一份 <.kunpeng>/spans/<flowId>.jsonl。根 span = 整条流（invoke_agent），
 *  子 span = 每次 agent 调用（chat <stage>）；字段对齐 OTel（traceId/spanId/parentSpanId + gen_ai.* 属性），
 *  只落本机文件、不外发。可观测是尽力而为：落盘失败返回 false，由调用方告警，不影响流本身。 */
import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type SpanAttributes = Record<string, string | number | boolean>;

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startMs: number;
  endMs: number;
  status: "ok" | "error";
  attributes: SpanAttributes;
}

export const ROOT_SPAN_NAME = "invoke_agent kunpeng.flow";

/** 同一 flowId 恒得同一 traceId（重跑/续跑的 span 归到同一棵树）。 */
export function traceIdForFlow(flowId: string): string {
  return createHash("sha256").update(flowId).digest("hex").slice(0, 32);
}

export function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

export function spanLogPath(kunpengDir: string, flowId: string): string {
  return join(kunpengDir, "spans", `${flowId}.jsonl`);
}

async function appendSpan(path: string, span: SpanRecord): Promise<boolean> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(span) + "\n");
    return true;
  } catch {
    return false;
  }
}

/** 读回一条流的全部 span；坏行跳过。文件不存在 → 空数组。 */
export async function readSpans(path: string): Promise<SpanRecord[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const out: SpanRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as SpanRecord);
    } catch {
      // 坏行（例如写到一半被杀）跳过，不影响其它 span。
    }
  }
  return out;
}

export interface FlowSpans {
  readonly traceId: string;
  readonly rootSpanId: string;
  child(name: string, startMs: number, status: "ok" | "error", attributes: SpanAttributes): Promise<boolean>;
  finishRoot(status: "ok" | "error", attributes: SpanAttributes): Promise<boolean>;
}

export function createFlowSpans(kunpengDir: string, flowId: string, now: () => number = Date.now): FlowSpans {
  const path = spanLogPath(kunpengDir, flowId);
  const traceId = traceIdForFlow(flowId);
  const rootSpanId = newSpanId();
  const rootStart = now();
  return {
    traceId,
    rootSpanId,
    child: (name, startMs, status, attributes) => appendSpan(path, {
      traceId, spanId: newSpanId(), parentSpanId: rootSpanId, name, startMs, endMs: now(), status, attributes,
    }),
    finishRoot: (status, attributes) => appendSpan(path, {
      traceId, spanId: rootSpanId, name: ROOT_SPAN_NAME, startMs: rootStart, endMs: now(), status,
      attributes: { "gen_ai.operation.name": "invoke_agent", "kunpeng.flow.id": flowId, ...attributes },
    }),
  };
}
