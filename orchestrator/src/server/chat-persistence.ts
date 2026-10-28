import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ConversationStore,
  type Conversation,
  type ChatTurn as StoredChatTurn,
} from "../chat/conversation-store.js";

declare module "../chat/conversation-store.js" {
  interface Conversation {
    loopRefs?: string[];
  }
}

/**
 * ConversationStore 暂无通用 meta 更新入口；按其 JSON 原子替换方式，只追加本会话 loopRefs。
 * 不更新 updatedAt/index：紧随其后的 persistChatRound 会完成正常会话更新时间与索引持久化。
 */
export async function appendConversationLoopRef(
  store: ConversationStore,
  username: string,
  convId: string,
  fingerprint: string,
): Promise<void> {
  if (!/^[0-9a-f]{8,}$/i.test(fingerprint)) throw new Error("Invalid loop fingerprint");
  const baseDir = (store as unknown as { baseDir?: unknown }).baseDir;
  if (typeof baseDir !== "string" || !baseDir) throw new Error("Conversation store path unavailable");
  const path = join(baseDir, encodeURIComponent(username), `${encodeURIComponent(convId)}.json`);
  const raw = await readFile(path, "utf8");
  const conversation = JSON.parse(raw) as Conversation;
  if (conversation.id !== convId || conversation.username !== username) {
    throw new Error("Conversation identity mismatch");
  }
  const refs = Array.isArray(conversation.loopRefs)
    ? conversation.loopRefs.filter((value): value is string => typeof value === "string")
    : [];
  if (!refs.includes(fingerprint)) refs.push(fingerprint);
  conversation.loopRefs = refs;
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(conversation, null, 2)}\n`, "utf8");
  try {
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

/** 从最后一个 assistant 压缩点（含）重放；无压缩点时返回全部 turns。 */
export function buildReplayTurns(
  conversation: Pick<Conversation, "turns">,
  excludeLastRound = false,
): StoredChatTurn[] {
  let replayTurns = conversation.turns;
  if (excludeLastRound) {
    let lastUserIndex = -1;
    for (let index = replayTurns.length - 1; index >= 0; index -= 1) {
      if (replayTurns[index].role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    replayTurns = lastUserIndex < 0 ? [] : replayTurns.slice(0, lastUserIndex);
  }

  let lastCompactIndex = -1;
  for (let index = replayTurns.length - 1; index >= 0; index -= 1) {
    const turn = replayTurns[index];
    if (turn.role === "assistant" && turn.compact === true) {
      lastCompactIndex = index;
      break;
    }
  }
  const compactReplayTurns = lastCompactIndex < 0
    ? replayTurns
    : replayTurns.slice(lastCompactIndex);
  return compactReplayTurns.map((turn) => (
    turn.role === "assistant" && turn.compact === true
      ? { ...turn, text: `【前文摘要】${turn.text}` }
      : turn
  ));
}

/** 回写一轮对话(user+assistant)到持久化会话;assistant 轮标记本次 web。 */
export async function persistChatRound(
  store: ConversationStore,
  username: string,
  convId: string,
  round: { userText: string; replyText: string; web?: boolean; compact?: boolean; at?: number; usage?: StoredChatTurn["usage"] },
  replaceLast = false,
): Promise<void> {
  if (replaceLast) {
    const replaced = await store.replaceLastRound(username, convId, round);
    if (replaced !== null) return;
  }
  await store.appendTurns(username, convId, [
    {
      role: "user",
      text: round.userText,
      ...(round.at !== undefined ? { at: round.at } : {}),
    },
    {
      role: "assistant",
      text: round.replyText,
      ...(round.web !== undefined ? { web: round.web } : {}),
      ...(round.compact !== undefined ? { compact: round.compact } : {}),
      ...(round.at !== undefined ? { at: round.at } : {}),
      ...(round.usage ? { usage: round.usage } : {}),
    },
  ]);
}

/**
 * 从尾部向前收取回放轮次，限制拼进单 prompt 的总字符量。
 * 至少保留最后 1 条；非法 maxChars 只留最后 1 条；元素为原对象引用，不复制、不改写。
 */
export function capReplayTurns(
  turns: readonly StoredChatTurn[],
  maxChars: number,
): { turns: StoredChatTurn[]; dropped: number } {
  if (turns.length === 0) return { turns: [], dropped: 0 };
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 0;
  const kept: StoredChatTurn[] = [];
  let total = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (kept.length === 0) {
      // 至少保留最后 1 条，即使其本身超过 maxChars。
      kept.push(turn);
      total += turn.text.length;
      continue;
    }
    const next = total + turn.text.length;
    if (next > limit) break;
    kept.push(turn);
    total = next;
  }
  kept.reverse();
  return { turns: kept, dropped: turns.length - kept.length };
}

function sessionKey(username: string, session: string, projectId?: string): string {
  return `${username}\u0000${projectId ?? ""}\u0000${session}`;
}

/**
 * 解析本轮对话归属的 convId：
 * - 有 conv 且属当前 username → 复用该 conv；
 * - 有 conv 但不属当前 username → 新建会话（隔离，不串号）；
 * - 无 conv 但有 session → 按 (username,projectId,session) 用持久映射稳定到同一会话，首次懒建；
 * - 都没有 → 新建会话。
 */
export async function resolveConversationId(
  store: ConversationStore,
  username: string,
  opts: { conv?: string; session?: string; model: string; projectId?: string; sensitive?: boolean },
): Promise<string> {
  const conv = opts.conv?.trim();
  if (conv) {
    const owned = await store.get(username, conv);
    if (owned && owned.projectId === opts.projectId) {
      if (owned.archived === true) await store.restore(username, owned.id);
      return owned.id;
    }
    return (await store.create(username, { model: opts.model, projectId: opts.projectId, sensitive: opts.sensitive })).id;
  }

  const session = opts.session?.trim();
  if (session) {
    const key = sessionKey(username, session, opts.projectId);
    const existing = await store.getSessionConv(key);
    const owned = existing ? await store.get(username, existing) : null;
    if (owned) {
      if (owned.archived === true) await store.restore(username, owned.id);
      return owned.id;
    }
    const created = await store.create(username, { model: opts.model, projectId: opts.projectId, sensitive: opts.sensitive });
    await store.setSessionConv(key, created.id);
    return created.id;
  }

  return (await store.create(username, { model: opts.model, projectId: opts.projectId, sensitive: opts.sensitive })).id;
}
