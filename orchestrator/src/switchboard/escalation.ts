import type { SwitchMessage } from "./store.js";

export interface Escalation {
  message: SwitchMessage;
  reason: "recipient-offline" | "stale-unread";
}

export function findEscalations(deps: {
  messages: SwitchMessage[];
  online: string[];
  now: number;
  staleMs?: number;
}): Escalation[] {
  const staleMs = deps.staleMs ?? 5 * 60_000;
  const onlineSet = new Set(deps.online);
  const out: Escalation[] = [];
  for (const m of deps.messages) {
    if (!m.urgent || m.read) continue;
    const recipientOffline = m.to !== "all" && !onlineSet.has(m.to);
    if (recipientOffline) {
      out.push({ message: m, reason: "recipient-offline" });
    } else if (deps.now - m.ts > staleMs) {
      out.push({ message: m, reason: "stale-unread" });
    }
  }
  return out;
}
