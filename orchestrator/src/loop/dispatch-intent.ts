import { wrapUntrusted } from "../security/prompt-shield.js";

export const DISPATCH_UNTRUSTED_SOURCE = "webhook 派单";

export interface DispatchEvent {
  label?: string;
  title?: string;
  body?: string;
  number?: number;
}

export interface DispatchIntent {
  requirement: string;
  branch: string;
}

const DISPATCH_LABEL = "kunpeng:dispatch";
const DISPATCH_MARKER = "/kunpeng";

/** GitHub 风格事件 → 派单意图。label===DISPATCH_LABEL 或 body 含 DISPATCH_MARKER 触发;
 *  requirement=title+body(去空白非空)用 "\n\n" 连;branch=`kp/dispatch-${number??0}`;未触发/空需求→null。 */
export function parseDispatchEvent(ev: DispatchEvent): DispatchIntent | null {
  const triggered = ev.label === DISPATCH_LABEL || (ev.body?.includes(DISPATCH_MARKER) ?? false);
  if (!triggered) return null;
  const raw = [ev.title?.trim() ?? "", ev.body?.trim() ?? ""].filter(Boolean).join("\n\n");
  if (!raw) return null;
  // 外部触发体一律包成不可信数据（审计 P1-4 / Claude C1）：它是"要做什么"的材料，不是对 agent 的指令。
  return { requirement: wrapUntrusted(DISPATCH_UNTRUSTED_SOURCE, raw), branch: `kp/dispatch-${ev.number ?? 0}` };
}
