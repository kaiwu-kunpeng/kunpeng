import { parseDispatchEvent, type DispatchEvent, type DispatchIntent } from "../loop/dispatch-intent.js";

export interface DispatchResult {
  ok: boolean;
  dispatched: boolean;
  branch?: string;
  requirement?: string;
}

/** 解析 webhook body 为派单事件;命中则调 kickoff(意图)并回执 dispatched:true;不命中→dispatched:false。
 *  kickoff 注入便于测试。body 非对象按空事件处理。 */
export async function handleDispatch(
  body: unknown,
  kickoff: (intent: DispatchIntent) => Promise<void>,
): Promise<DispatchResult> {
  const ev = (body && typeof body === "object" ? body : {}) as DispatchEvent;
  const intent = parseDispatchEvent(ev);
  if (!intent) return { ok: true, dispatched: false };
  await kickoff(intent);
  return { ok: true, dispatched: true, branch: intent.branch, requirement: intent.requirement };
}
