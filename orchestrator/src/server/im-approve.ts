import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isHardGateLevel, type ActionLevel } from "../policy/action-levels.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { hasErrnoCode } from "../util/errors.js";

export const IM_MAX_APPROVE_LEVEL = "L2";
export const IM_TICKET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export type ImOutcome = "approve" | "reject";

export interface ImTicket {
  id: string;
  flowId: string;
  level: ActionLevel;
  issuedAt: number;
  expiresAt: number;
  usedAt?: number;
  usedBy?: string;
  outcome?: ImOutcome;
}

export type RedeemResult =
  | { ok: true; ticket: ImTicket }
  | { ok: false; reason: "unknown" | "used" | "expired" | "level-capped" };

const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newImTicketId(): string {
  return Array.from({ length: 6 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join("");
}

export function imApprovable(level: ActionLevel): boolean {
  return !isHardGateLevel(level);
}

export async function readImTickets(stateDir: string): Promise<ImTicket[]> {
  try {
    const tickets: unknown = JSON.parse(await readFile(join(stateDir, "im-tickets.json"), "utf8"));
    if (!Array.isArray(tickets)) throw new Error("IM 票据状态不是数组");
    return tickets as ImTicket[];
  } catch (error) {
    if (hasErrnoCode(error, "ENOENT")) return [];
    throw error;
  }
}

// 签发与兑票共用写队列，读→检查→原子写入不可交错，防止并发请求重复消费。
let ticketWrites: Promise<void> = Promise.resolve();
function withTicketWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = ticketWrites.then(operation);
  // 原调用者仍收到失败；队列恢复后允许下一次操作重试。
  ticketWrites = result.then(() => undefined, () => undefined);
  return result;
}

function writeImTickets(stateDir: string, tickets: ImTicket[], now: number): Promise<void> {
  const retained = tickets.filter((ticket) => ticket.expiresAt >= now - IM_TICKET_TTL_MS);
  return writeFileAtomic(join(stateDir, "im-tickets.json"), JSON.stringify(retained, null, 2), { mode: 0o600 });
}

export function issueImTicket(
  stateDir: string,
  opts: { flowId: string; level: ActionLevel; now?: number; ttlMs?: number },
): Promise<ImTicket> {
  return withTicketWrite(async () => {
    const now = opts.now ?? Date.now();
    const tickets = await readImTickets(stateDir);
    const existing = tickets.find((ticket) => ticket.flowId === opts.flowId && ticket.usedAt === undefined && ticket.expiresAt > now);
    if (existing) return existing;
    let id = newImTicketId();
    while (tickets.some((ticket) => ticket.id === id)) id = newImTicketId();
    const ticket: ImTicket = {
      id, flowId: opts.flowId, level: opts.level, issuedAt: now,
      expiresAt: now + (opts.ttlMs ?? IM_TICKET_TTL_MS),
    };
    tickets.push(ticket);
    await writeImTickets(stateDir, tickets, now);
    return ticket;
  });
}

export function redeemImTicket(
  stateDir: string, id: string,
  opts: { by: string; outcome: ImOutcome; now?: number },
): Promise<RedeemResult> {
  return withTicketWrite(async (): Promise<RedeemResult> => {
    const now = opts.now ?? Date.now();
    const tickets = await readImTickets(stateDir);
    const ticket = tickets.find((entry) => entry.id === id);
    if (!ticket) return { ok: false, reason: "unknown" };
    if (ticket.usedAt !== undefined) return { ok: false, reason: "used" };
    if (ticket.expiresAt <= now) return { ok: false, reason: "expired" };
    if (opts.outcome === "approve" && !imApprovable(ticket.level)) return { ok: false, reason: "level-capped" };
    ticket.usedAt = now;
    ticket.usedBy = opts.by;
    ticket.outcome = opts.outcome;
    await writeImTickets(stateDir, tickets, now);
    return { ok: true, ticket };
  });
}

export function parseImReply(text: string): { outcome: ImOutcome; id: string } | undefined {
  const match = /^(yes|y|ok|批准|no|n|拒绝)\s+([a-z0-9]{6})$/i.exec(text.trim());
  if (!match) return undefined;
  return { outcome: /^(yes|y|ok|批准)$/i.test(match[1]) ? "approve" : "reject", id: match[2].toLowerCase() };
}

export function describeRedeemFailure(result: Extract<RedeemResult, { ok: false }>): string {
  switch (result.reason) {
    case "unknown": return "找不到该审批票据，请检查票据 id";
    case "used": return "该审批票据已被使用（先到先用），请到驾驶舱查看结果";
    case "expired": return "该审批票据已过期，请到驾驶舱处理";
    case "level-capped": return "IM 入口仅支持批准 L2 及以下，该门须在驾驶舱批准；仍可在此拒绝";
  }
}
