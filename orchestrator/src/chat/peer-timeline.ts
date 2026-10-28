import type { ChatTurn, TurnActivity } from "./conversation-store.js";
import { kindOf, type SwitchMessage } from "../switchboard/store.js";

export const PEER_WINDOW_MS = 7 * 24 * 3600 * 1000;

/**
 * 只保留时间窗内的普通消息，避免协议报文与历史回填进入会话时间线。
 * 纯函数：返回新数组，保持传入顺序与元素对象引用，不改写入参。
 */
export function filterPeerMessages(
  messages: SwitchMessage[],
  now: number,
  windowMs: number,
): SwitchMessage[] {
  const cutoff = now - windowMs;
  return messages.filter((message) => kindOf(message) === "msg" && message.ts > cutoff);
}

/**
 * 把一条跨实例消息映射为一条 peer 类型的 ChatTurn。
 * 纯函数：不读文件、不依赖时钟。role 保持 "user"，不把联合类型扩成三种。
 */
export function peerMessageToTurn(msg: SwitchMessage): ChatTurn {
  const text = msg.topic !== undefined && msg.topic !== ""
    ? `【${msg.from} · ${msg.topic}】${msg.body}`
    : `【${msg.from}】${msg.body}`;
  return {
    role: "user",
    kind: "peer",
    at: msg.ts,
    text,
    peer: { from: msg.from, topic: msg.topic, msgId: msg.id },
  };
}

/**
 * 归并原 turns 与 peer turns 为同一条时间线（读取时并流，不落盘）。
 * - 每条 turn 的「有效时间」：有 at 用 at；无 at 继承前一条有效时间；首条无 at 记为 0。
 * - 按有效时间升序；同一时间点原 turns 在前、peer 在后。
 * - peerTurns 内部按 at 升序、at 相同保持传入顺序（稳定排序）。
 * - 返回新数组，元素一律传入的原对象引用（不复制、不改写）。
 */
export function mergeTimeline(turns: ChatTurn[], peerTurns: ChatTurn[]): ChatTurn[] {
  if (peerTurns.length === 0) return turns;

  let prev = 0;
  const timedTurns = turns.map((turn, index) => {
    const effective = turn.at ?? prev;
    prev = effective;
    return { turn, effective, order: index, isPeer: false };
  });

  const timedPeers = peerTurns.map((turn, index) => ({
    turn,
    effective: turn.at ?? 0,
    order: index,
    isPeer: true,
  }));

  return [...timedTurns, ...timedPeers]
    .map((entry, seq) => ({ ...entry, seq }))
    .sort((a, b) =>
      a.effective - b.effective
      || (a.isPeer ? 1 : 0) - (b.isPeer ? 1 : 0)
      || (a.isPeer && b.isPeer ? a.order - b.order : 0)
      || a.seq - b.seq)
    .map((entry) => entry.turn);
}

/**
 * 把跨实例消息归属到「消息到达那一刻最后被动过的那个会话」，并只保留归属到 convId 的那些。
 * - 候选：存在 turn 时间 t<=m.ts 的会话；分数=max{t∈turnTimes: t<=m.ts}。
 * - 取分数最大者；同分取 convId 字典序最小；无候选则丢弃。
 * - 只返回归属===入参 convId 的消息，按 ts 升序、同 ts 按 id 升序。
 * 纯函数：不读盘、不看时钟、不改写入参（含不排序原数组），返回原消息对象引用。
 */
export function attributePeerMessages(
  messages: SwitchMessage[],
  activity: TurnActivity[],
  convId: string,
): SwitchMessage[] {
  const attributed: SwitchMessage[] = [];
  for (const message of messages) {
    let bestConv: string | undefined;
    let bestScore = -Infinity;
    for (const entry of activity) {
      let score = -Infinity;
      for (const t of entry.turnTimes) {
        if (t <= message.ts && t > score) score = t;
      }
      if (score === -Infinity) continue;
      if (score > bestScore || (score === bestScore && (bestConv === undefined || entry.convId < bestConv))) {
        bestScore = score;
        bestConv = entry.convId;
      }
    }
    if (bestConv === convId) attributed.push(message);
  }
  return attributed.sort((a, b) =>
    a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface PeerMessagesReaderDeps {
  /** 本实例身份（收件箱收件人）。 */
  self: string;
  /** 归属计算所用的用户名（读该用户全部会话的活跃时间）。 */
  username: string;
  inbox: (to: string) => Promise<SwitchMessage[]>;
  activity: (username: string) => Promise<TurnActivity[]>;
  now?: () => number;
}

/**
 * 组装一个 peerMessages 读取器：读本实例收件箱 + 该用户会话活跃时间，交给 attributePeerMessages 归属。
 * 底层 inbox/activity 抛出的异常原样向上抛，不吞（由端点层决定是否降级）。
 */
export function createPeerMessagesReader(
  deps: PeerMessagesReaderDeps,
): (conversation: { id: string }) => Promise<SwitchMessage[]> {
  return async (conversation) => {
    const inbox = await deps.inbox(deps.self);
    const messages = filterPeerMessages(inbox, (deps.now ?? Date.now)(), PEER_WINDOW_MS);
    const activity = await deps.activity(deps.username);
    return attributePeerMessages(messages, activity, conversation.id);
  };
}
