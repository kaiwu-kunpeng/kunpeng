import { kindOf, newMessage, type SwitchDeps, type SwitchMessage, type SwitchboardStore } from "./store.js";

export interface CheckStopSignalResult {
  stopped: boolean;
  stops: SwitchMessage[];
  receipts: SwitchMessage[];
  reason: string;
}

export async function sendStop(
  store: SwitchboardStore,
  from: string,
  to: string,
  body: string,
  deps: SwitchDeps,
): Promise<SwitchMessage> {
  if (to === "") throw new Error("signal 缺收件人");

  const msg = newMessage({ from, to, body, kind: "stop" }, deps);
  await store.append(msg);
  return msg;
}

function stopSummary(stop: SwitchMessage): string {
  return `[${stop.from}] ${stop.body.slice(0, 80)}`;
}

export async function ackStop(
  store: SwitchboardStore,
  stop: SwitchMessage,
  me: string,
  deps: SwitchDeps,
): Promise<SwitchMessage> {
  if (kindOf(stop) !== "stop") throw new Error("只能对 stop 回执");

  const msg = newMessage({ from: me, to: stop.from, topic: stop.id, body: "已停止", kind: "receipt" }, deps);
  await store.append(msg);
  return msg;
}

export async function checkStopSignal(
  store: SwitchboardStore,
  me: string,
  deps: SwitchDeps,
): Promise<CheckStopSignalResult> {
  const instance = me.trim();
  if (instance === "") throw new Error("检查停止信号缺实例身份");

  const stops = await store.pendingStops(instance);
  if (stops.length === 0) {
    return { stopped: false, stops: [], receipts: [], reason: "" };
  }

  const receipts: SwitchMessage[] = [];
  for (const stop of stops) {
    receipts.push(await ackStop(store, stop, instance, deps));
    await store.markRead(stop.id);
  }

  return {
    stopped: true,
    stops,
    receipts,
    reason: stops.map(stopSummary).join("; "),
  };
}
