import { isRecord } from "../util/is-record.js";
import { conversationToMarkdown, type Conversation, type ConversationStore } from "../chat/conversation-store.js";
import { mergeTimeline, peerMessageToTurn } from "../chat/peer-timeline.js";
import { extractSearchedData } from "../chat/kb-extract.js";
import type { SwitchMessage } from "../switchboard/store.js";

export interface ConversationActionDeps {
  store: ConversationStore;
  username: string;
  now?: () => number;
  /** 对软删会话沉淀「搜寻的数据」进知识库；仅在该会话存在搜寻数据时被调用一次。 */
  captureSearched: (conversation: Conversation) => void | Promise<void>;
  /** 可选：读取该会话相关的跨实例消息，GET 时并流入时间线（不落盘）。取消息抛异常时降级为不合并。 */
  peerMessages?: (conversation: Conversation) => SwitchMessage[] | Promise<SwitchMessage[]>;
}

export interface ActionResult {
  status: number;
  json?: unknown;
}

/**
 * 会话端点纯逻辑层（不解析 HTTP）：归属由调用方注入的 deps.username 决定。
 * method ∈ GET|PATCH|DELETE|POST(restore/fork)；id 为路径中的会话 id（list 时为 null）。
 */
export async function handleConversationAction(
  method: string,
  id: string | null,
  body: unknown,
  deps: ConversationActionDeps,
): Promise<ActionResult> {
  const normalizedMethod = method.toUpperCase();

  if (normalizedMethod === "GET" && id === "search") {
    const query = isRecord(body) && typeof body.q === "string" ? body.q : "";
    return { status: 200, json: await deps.store.searchConversations(deps.username, query) };
  }

  if (
    normalizedMethod === "GET" &&
    id === null &&
    isRecord(body) &&
    typeof body.q === "string" &&
    body.q.trim() !== ""
  ) {
    return { status: 200, json: await deps.store.searchConversations(deps.username, body.q) };
  }

  if (normalizedMethod === "GET" && id === null) {
    const archived = isRecord(body) && (body.archived === true || body.archived === "true");
    if (!archived) {
      const expired = await deps.store.archiveExpired(deps.username, (deps.now ?? Date.now)());
      for (let index = 0; index < expired.length; index += 1) {
        await captureArchivedToKb(expired[index], deps);
      }
    }
    const conversations = await deps.store.list(deps.username, { archived });
    return {
      status: 200,
      json: archived ? conversations.filter((conversation) => conversation.archived) : conversations,
    };
  }

  if (id === null || id.trim() === "") {
    return { status: 400, json: { ok: false, error: "缺会话 id" } };
  }

  if (normalizedMethod === "GET") {
    const conversation = await deps.store.get(deps.username, id);
    if (!conversation) return notFound();
    const merged = await mergeConversationWithPeers(conversation, deps);
    if (isRecord(body) && body.format === "md") {
      return {
        status: 200,
        json: {
          ok: true,
          format: "md",
          filename: `${conversation.title || conversation.id}.md`,
          content: conversationToMarkdown(merged),
        },
      };
    }
    return { status: 200, json: merged };
  }

  if (normalizedMethod === "PATCH") {
    if (!isRecord(body)) {
      return { status: 400, json: { ok: false, error: "PATCH 请求体无效" } };
    }
    const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");
    const hasSensitive = Object.prototype.hasOwnProperty.call(body, "sensitive");
    const hasPinned = Object.prototype.hasOwnProperty.call(body, "pinned");
    const hasTtlDays = Object.prototype.hasOwnProperty.call(body, "ttlDays");
    if (hasTitle && typeof body.title !== "string") {
      return { status: 400, json: { ok: false, error: "title 必须是字符串" } };
    }
    if (hasSensitive && typeof body.sensitive !== "boolean") {
      return { status: 400, json: { ok: false, error: "sensitive 必须是布尔值" } };
    }
    if (hasPinned && typeof body.pinned !== "boolean") {
      return { status: 400, json: { ok: false, error: "pinned 必须是布尔值" } };
    }
    if (
      hasTtlDays
      && body.ttlDays !== null
      && (
        typeof body.ttlDays !== "number"
        || !Number.isInteger(body.ttlDays)
        || body.ttlDays < 1
        || body.ttlDays > 365
      )
    ) {
      return { status: 400, json: { ok: false, error: "ttlDays 必须是 null 或 1..365 的整数" } };
    }
    if (!hasTitle && !hasSensitive && !hasPinned && !hasTtlDays) {
      return { status: 400, json: { ok: false, error: "PATCH 缺少可更新字段" } };
    }
    if (!(await deps.store.get(deps.username, id))) return notFound();
    if (hasTitle) await deps.store.rename(deps.username, id, body.title as string);
    if (hasSensitive) await deps.store.setSensitive(deps.username, id, body.sensitive as boolean);
    if (hasPinned) await deps.store.setPinned(deps.username, id, body.pinned as boolean);
    if (hasTtlDays) await deps.store.setTtlDays(deps.username, id, body.ttlDays as number | null);
    return { status: 200, json: await deps.store.get(deps.username, id) };
  }

  if (normalizedMethod === "DELETE") {
    if (!(await deps.store.get(deps.username, id))) return notFound();
    const archived = await captureArchivedToKb(
      await deps.store.archive(deps.username, id),
      deps,
    );
    return { status: 200, json: archived };
  }

  if (normalizedMethod === "POST") {
    if (isRecord(body) && body.action === "fork") {
      const forked = await deps.store.fork(deps.username, id);
      if (!forked) return notFound();
      return { status: 200, json: forked };
    }
    if (isRecord(body) && body.action === "purge") {
      try {
        const purged = await deps.store.purge(deps.username, id);
        return purged ? { status: 200, json: { ok: true } } : notFound();
      } catch (error) {
        if (error instanceof Error && error.message === "仅归档会话可彻底删除") {
          return { status: 409, json: { ok: false, error: error.message } };
        }
        throw error;
      }
    }
    if (!(await deps.store.get(deps.username, id))) return notFound();
    await deps.store.restore(deps.username, id);
    return { status: 200, json: await deps.store.get(deps.username, id) };
  }

  return { status: 405, json: { ok: false, error: "方法不支持" } };
}

/**
 * GET 时把跨实例消息并流入会话时间线（不落盘）。
 * 未注入 peerMessages 依赖 → 原样返回同一 conversation 对象（行为与改动前完全一致）。
 * 取消息抛异常 → 降级为不合并，照常返回，不 500。
 */
async function mergeConversationWithPeers(
  conversation: Conversation,
  deps: ConversationActionDeps,
): Promise<Conversation> {
  if (deps.peerMessages === undefined) return conversation;
  let messages: SwitchMessage[];
  try {
    messages = await deps.peerMessages(conversation);
  } catch {
    return conversation;
  }
  const peerTurns = messages.map(peerMessageToTurn);
  return { ...conversation, turns: mergeTimeline(conversation.turns, peerTurns) };
}

async function captureArchivedToKb(
  conversation: Conversation,
  deps: ConversationActionDeps,
): Promise<Conversation> {
  if (
    conversation.sensitive === true
    || conversation.sensitiveEver !== false
    || conversation.capturedToKb === true
    || extractSearchedData(conversation.turns).length === 0
  ) return conversation;

  try {
    await deps.captureSearched(conversation);
    await deps.store.markCapturedToKb(deps.username, conversation.id);
    return (await deps.store.get(deps.username, conversation.id)) ?? conversation;
  } catch (error) {
    console.warn(`[conversation-endpoints] KB capture failed for ${conversation.id}: ${String(error)}`);
    return conversation;
  }
}

function notFound(): ActionResult {
  return { status: 404, json: { ok: false, error: "会话不存在" } };
}
