import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { isNodeError } from "../util/errors.js";

export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  web?: boolean;
  compact?: boolean;
  at?: number;
  kind?: "message" | "peer";
  peer?: { from: string; topic?: string; msgId: string };
  usage?: { input?: number; output?: number; cacheCreate?: number; cacheRead?: number; model?: string };
  alternatives?: Array<{ text: string; at: number }>;
};

export const CONVERSATION_SCHEMA_VERSION = 2;

/** 一条会话的活跃时间戳集合：turnTimes 为该会话所有有限 turn.at 的升序数组。 */
export interface TurnActivity {
  convId: string;
  turnTimes: number[];
}

export interface Conversation {
  schemaVersion?: number;
  id: string;
  title: string;
  username: string;
  projectId?: string;
  cliSessionId?: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  archivedAt?: number;
  capturedToKb?: boolean;
  sensitive?: boolean;
  sensitiveEver?: boolean;
  pinned?: boolean;
  ttlDays?: number;
  turns: ChatTurn[];
}

export function migrateConversation(raw: unknown): Conversation {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("Invalid Conversation");
  }

  const conversation = raw as Record<string, unknown>;
  const schemaVersion = conversation.schemaVersion;
  return {
    ...conversation,
    sensitiveEver:
      conversation.sensitive === true || conversation.sensitiveEver !== false,
    schemaVersion:
      typeof schemaVersion === "number" && schemaVersion >= CONVERSATION_SCHEMA_VERSION
        ? schemaVersion
        : CONVERSATION_SCHEMA_VERSION,
  } as unknown as Conversation;
}

export type ConversationSummary = Pick<
  Conversation,
  "id" | "title" | "model" | "updatedAt" | "archived" | "capturedToKb" | "ttlDays"
> & { sensitive: boolean; pinned: boolean; messageCount: number };

export interface ConversationSearchResult {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: number;
  snippet: string;
  archived?: boolean;
  sensitive?: boolean;
}

export interface StoreDeps {
  now: () => number;
  id: () => string; // 形如 conv-{ts}-{hex}
}

const INDEX_FILE = "index.json";
const SESSION_INDEX_FILE = "session-index.json";
const MAX_SESSION_INDEX_ENTRIES = 500;
const DEFAULT_TITLE = "新对话";
let tempFileSequence = 0;

export function classifyConversationDirEntries(
  files: string[],
): { ids: string[]; strays: string[] } {
  const ids: string[] = [];
  const strays: string[] = [];

  for (const file of files) {
    if (file === INDEX_FILE) continue;
    if (!file.endsWith(".json")) {
      strays.push(file);
      continue;
    }

    try {
      ids.push(decodeURIComponent(file.slice(0, -".json".length)));
    } catch {
      strays.push(file);
    }
  }

  ids.sort((a, b) => a.localeCompare(b));
  return { ids, strays };
}

interface SessionIndexEntry {
  convId: string;
  at: number;
}

type SessionIndex = Record<string, SessionIndexEntry>;

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const normalizedLimit = Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 1));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(normalizedLimit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export function conversationMatchesQuery(
  conv: { title: string; turns: Array<{ text: string }> },
  query: string,
): { matched: boolean; snippet: string } {
  const q = query.trim().toLowerCase();
  if (q === "") return { matched: false, snippet: "" };

  if (conv.title.toLowerCase().includes(q)) {
    return { matched: true, snippet: conv.title };
  }

  for (const turn of conv.turns) {
    const index = turn.text.toLowerCase().indexOf(q);
    if (index === -1) continue;

    const start = Math.max(0, index - 30);
    const end = Math.min(turn.text.length, index + q.length + 30);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < turn.text.length ? "…" : "";
    return { matched: true, snippet: `${prefix}${turn.text.slice(start, end)}${suffix}` };
  }

  return { matched: false, snippet: "" };
}

export function conversationToMarkdown(conv: {
  title: string;
  model?: string;
  turns: Array<{
    role: string;
    text: string;
    usage?: { model?: string };
  }>;
}): string {
  const blocks = [`# ${conv.title || "未命名会话"}`];

  for (const turn of conv.turns) {
    if (turn.role === "user") {
      blocks.push(`## 用户\n\n${turn.text}`);
      continue;
    }

    if (turn.role === "assistant") {
      const model = turn.usage?.model;
      const heading = model ? `## 助手 _(${model})_` : "## 助手";
      blocks.push(`${heading}\n\n${turn.text}`);
      continue;
    }

    blocks.push(`## ${turn.role}\n\n${turn.text}`);
  }

  return `${blocks.join("\n\n")}\n`;
}

/** 尾部读取：limit<=0 → []；limit>=len → 全部；否则最后 limit 条。顺序与引用不变。 */
export function tailTurns(turns: ChatTurn[], limit: number): ChatTurn[] {
  if (limit <= 0) return [];
  if (limit >= turns.length) return turns.slice();
  return turns.slice(turns.length - limit);
}

export class ConversationStore {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly baseDir: string, // ~/.kunpeng/chat
    private readonly deps: StoreDeps,
  ) {}

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, tail);

    try {
      return await current;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  private conversationLockKey(username: string, id: string): string {
    return `${username}::${id}`;
  }

  private indexLockKey(username: string): string {
    return `__index__::${username}`;
  }

  private userDir(username: string): string {
    return join(this.baseDir, encodeURIComponent(username));
  }

  private conversationPath(username: string, id: string): string {
    return join(this.userDir(username), `${encodeURIComponent(id)}.json`);
  }

  private indexPath(username: string): string {
    return join(this.userDir(username), INDEX_FILE);
  }

  private sessionIndexPath(): string {
    return join(this.baseDir, SESSION_INDEX_FILE);
  }

  private conversationMcpConfigPath(id: string): string {
    return join(dirname(this.baseDir), "chat-mcp", `${id}.localfs.mcp.json`);
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    const tmp = `${path}.${process.pid}.${this.deps.now()}.${++tempFileSequence}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    try {
      await fs.rename(tmp, path);
    } catch (error) {
      await fs.unlink(tmp).catch(() => {});
      throw error;
    }
  }

  private summary(conversation: Conversation): ConversationSummary {
    return {
      id: conversation.id,
      title: conversation.title,
      model: conversation.model,
      updatedAt: conversation.updatedAt,
      archived: conversation.archived,
      capturedToKb: conversation.capturedToKb,
      sensitive: conversation.sensitive === true,
      pinned: conversation.pinned === true,
      ttlDays: conversation.ttlDays,
      messageCount: conversation.turns.length,
    };
  }

  private sortSummaries(summaries: ConversationSummary[]): ConversationSummary[] {
    return [...summaries].sort(
      (a, b) => Number(b.pinned === true) - Number(a.pinned === true)
        || b.updatedAt - a.updatedAt
        || a.id.localeCompare(b.id),
    );
  }

  private async readConversation(username: string, id: string): Promise<Conversation | null> {
    try {
      const raw = await fs.readFile(this.conversationPath(username, id), "utf8");
      const conversation = migrateConversation(JSON.parse(raw) as unknown);
      return {
        ...conversation,
        sensitive: conversation.sensitive === true,
        pinned: conversation.pinned === true,
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      throw error;
    }
  }

  private async writeConversation(conversation: Conversation): Promise<void> {
    await fs.mkdir(this.userDir(conversation.username), { recursive: true });
    await this.writeJson(
      this.conversationPath(conversation.username, conversation.id),
      { ...conversation, schemaVersion: CONVERSATION_SCHEMA_VERSION },
    );
  }

  private async readIndex(username: string): Promise<ConversationSummary[] | null> {
    try {
      const raw = await fs.readFile(this.indexPath(username), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isConversationSummaryArray(parsed)) return null;
      return this.sortSummaries(parsed.map((summary) => ({
        ...summary,
        pinned: summary.pinned === true,
      })));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }

  private async writeIndex(username: string, summaries: ConversationSummary[]): Promise<void> {
    await fs.mkdir(this.userDir(username), { recursive: true });
    await this.writeJson(this.indexPath(username), this.sortSummaries(summaries));
  }

  private async readSessionIndex(): Promise<SessionIndex> {
    try {
      const raw = await fs.readFile(this.sessionIndexPath(), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return isSessionIndex(parsed) ? parsed : {};
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return {};
      if (error instanceof SyntaxError) return {};
      throw error;
    }
  }

  private async rebuildIndexUnlocked(username: string): Promise<ConversationSummary[]> {
    const dir = this.userDir(username);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }

    const ids = files
      .filter((file) => file.endsWith(".json") && file !== INDEX_FILE)
      .flatMap((file) => {
        try {
          return [decodeURIComponent(file.slice(0, -".json".length))];
        } catch {
          return [];
        }
      });
    const conversations = await mapWithConcurrency(
      ids,
      32,
      (id) => this.readConversation(username, id),
    );
    const summaries = conversations
      .filter((conversation): conversation is Conversation => conversation !== null)
      .map((conversation) => this.summary(conversation));
    await this.writeIndex(username, summaries);
    return this.sortSummaries(summaries);
  }

  private async rebuildIndex(username: string): Promise<ConversationSummary[]> {
    return this.withLock(this.indexLockKey(username), async () => {
      const current = await this.readIndex(username);
      return current ?? this.rebuildIndexUnlocked(username);
    });
  }

  private async upsertSummary(conversation: Conversation): Promise<void> {
    await this.withLock(this.indexLockKey(conversation.username), async () => {
      const current = (await this.readIndex(conversation.username))
        ?? (await this.rebuildIndexUnlocked(conversation.username));
      const next = current.filter((summary) => summary.id !== conversation.id);
      next.push(this.summary(conversation));
      await this.writeIndex(conversation.username, next);
    });
  }

  private async removeSummary(username: string, id: string): Promise<void> {
    await this.withLock(this.indexLockKey(username), async () => {
      const current = (await this.readIndex(username))
        ?? (await this.rebuildIndexUnlocked(username));
      await this.writeIndex(
        username,
        current.filter((summary) => summary.id !== id),
      );
    });
  }

  async migrateOwner(legacyUsername: string, accountId: string): Promise<void> {
    if (!legacyUsername || !accountId) throw new Error("Conversation owner migration requires both owners");
    if (legacyUsername === accountId) return;

    await this.withLock("__owner_migration__", async () => {
      const legacyDir = this.userDir(legacyUsername);
      const targetDir = this.userDir(accountId);
      const migratedDir = join(this.baseDir, ".migrated");
      const backupDir = join(
        migratedDir,
        `${encodeURIComponent(legacyUsername)}--${encodeURIComponent(accountId)}`,
      );
      await fs.mkdir(migratedDir, { recursive: true });

      const legacyExists = await isDirectory(legacyDir);
      const targetExists = await isDirectory(targetDir);
      const backupExists = await isDirectory(backupDir);
      if (!legacyExists) {
        if (backupExists && !targetExists) {
          throw new Error(`Conversation migration target is missing for ${accountId}`);
        }
        return;
      }
      if (backupExists) {
        throw new Error(`Conversation migration backup already exists while legacy owner remains: ${legacyUsername}`);
      }

      const sourceIds = await conversationIdsInDirectory(legacyDir);
      const sourceIdSet = new Set(sourceIds);
      if (targetExists) {
        const targetIds = await conversationIdsInDirectory(targetDir);
        const unexpected = targetIds.find((id) => !sourceIdSet.has(id));
        if (unexpected) {
          throw new Error(`Conversation migration target has conflicting conversation: ${unexpected}`);
        }
      }

      const migrated: Conversation[] = [];
      for (const id of sourceIds) {
        const source = await this.readConversation(legacyUsername, id);
        if (!source || source.id !== id || source.username !== legacyUsername) {
          throw new Error(`Invalid legacy conversation ownership: ${id}`);
        }
        const expected: Conversation = {
          ...source,
          schemaVersion: CONVERSATION_SCHEMA_VERSION,
          username: accountId,
        };
        const existing = await this.readConversation(accountId, id);
        if (existing && canonicalJson(existing) !== canonicalJson(expected)) {
          throw new Error(`Conversation migration target differs: ${id}`);
        }
        migrated.push(expected);
      }

      for (const conversation of migrated) await this.writeConversation(conversation);
      await fs.mkdir(targetDir, { recursive: true });
      await this.withLock(this.indexLockKey(accountId), async () => {
        await this.rebuildIndexUnlocked(accountId);
      });
      await fs.rename(legacyDir, backupDir);
    });
  }

  async list(
    username: string,
    opts?: { archived?: boolean },
  ): Promise<ConversationSummary[]> {
    const summaries = (await this.readIndex(username)) ?? (await this.rebuildIndex(username));
    const visible = opts?.archived ? summaries : summaries.filter((summary) => !summary.archived);
    return this.sortSummaries(visible);
  }

  async get(username: string, id: string): Promise<Conversation | null> {
    return this.readConversation(username, id);
  }

  /** 尾部读取会话：返回原始条数 total、截断后的 turns 与 truncated 标记；conversation.turns 保持原样不被截断。 */
  async getTail(
    username: string,
    id: string,
    limit: number,
  ): Promise<{ conversation: Conversation; turns: ChatTurn[]; total: number; truncated: boolean } | null> {
    const conversation = await this.readConversation(username, id);
    if (!conversation) return null;
    const total = conversation.turns.length;
    const turns = tailTurns(conversation.turns, limit);
    return { conversation, turns, total, truncated: turns.length < total };
  }

  /**
   * 汇总某用户全部会话（含归档）的活跃时间戳，供跨实例消息按「最近活跃会话」归属。
   * 并发读，单条读失败（null/抛异常）跳过而非整体失败；无合法 at 的会话仍返回 turnTimes:[]。
   * 结果按 convId 字典序升序，turnTimes 内部按有限值升序。
   */
  async listTurnActivity(username: string): Promise<TurnActivity[]> {
    const summaries = await this.list(username, { archived: true });
    const ids = summaries.map((summary) => summary.id);
    const activities = await mapWithConcurrency(ids, 32, async (id): Promise<TurnActivity | null> => {
      let conversation: Conversation | null;
      try {
        conversation = await this.readConversation(username, id);
      } catch {
        return null;
      }
      if (!conversation) return null;
      const turnTimes = conversation.turns
        .map((turn) => turn.at)
        .filter((at): at is number => typeof at === "number" && Number.isFinite(at))
        .sort((a, b) => a - b);
      return { convId: id, turnTimes };
    });
    return activities
      .filter((entry): entry is TurnActivity => entry !== null)
      .sort((a, b) => (a.convId < b.convId ? -1 : a.convId > b.convId ? 1 : 0));
  }

  async getSessionConv(key: string): Promise<string | undefined> {
    try {
      const index = await this.readSessionIndex();
      return index[key]?.convId;
    } catch {
      return undefined;
    }
  }

  async setSessionConv(key: string, convId: string): Promise<void> {
    await this.withLock("__session-index__", async () => {
      const index = await this.readSessionIndex();
      index[key] = { convId, at: this.deps.now() };

      const entries = Object.entries(index);
      if (entries.length > MAX_SESSION_INDEX_ENTRIES) {
        entries.sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0]));
        for (const [oldestKey] of entries.slice(0, entries.length - MAX_SESSION_INDEX_ENTRIES)) {
          delete index[oldestKey];
        }
      }

      await fs.mkdir(this.baseDir, { recursive: true });
      await this.writeJson(this.sessionIndexPath(), index);
    });
  }

  async search(
    username: string,
    query: string,
  ): Promise<ConversationSearchResult[]> {
    return this.searchConversations(username, query);
  }

  async searchConversations(
    username: string,
    query: string,
    limit = 20,
  ): Promise<ConversationSearchResult[]> {
    const normalizedQuery = query.trim();
    if (normalizedQuery === "") return [];

    const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 20;
    if (normalizedLimit === 0) return [];

    const summaries = await this.list(username, { archived: true });
    const results: Array<ConversationSearchResult & { titleMatched: boolean }> = [];

    for (const summary of summaries) {
      let conversation: Conversation | null;
      try {
        conversation = await this.get(username, summary.id);
      } catch {
        continue;
      }
      if (!conversation) continue;

      const titleSnippet = highlightedSnippet(conversation.title, normalizedQuery);
      if (titleSnippet !== null) {
        results.push({
          id: conversation.id,
          title: conversation.title,
          pinned: conversation.pinned === true,
          updatedAt: conversation.updatedAt,
          snippet: titleSnippet,
          archived: summary.archived,
          sensitive: summary.sensitive,
          titleMatched: true,
        });
        continue;
      }

      for (const turn of conversation.turns) {
        const snippet = highlightedSnippet(turn.text, normalizedQuery);
        if (snippet === null) continue;
        results.push({
          id: conversation.id,
          title: conversation.title,
          pinned: conversation.pinned === true,
          updatedAt: conversation.updatedAt,
          snippet,
          archived: summary.archived,
          sensitive: summary.sensitive,
          titleMatched: false,
        });
        break;
      }
    }

    return results
      .sort((a, b) => Number(b.titleMatched) - Number(a.titleMatched)
        || b.updatedAt - a.updatedAt
        || a.id.localeCompare(b.id))
      .slice(0, normalizedLimit)
      .map(({ titleMatched: _titleMatched, ...result }) => result);
  }

  async create(
    username: string,
    init: { model: string; projectId?: string; sensitive?: boolean },
  ): Promise<Conversation> {
    const now = this.deps.now();
    const conversation: Conversation = {
      id: this.deps.id(),
      title: DEFAULT_TITLE,
      username,
      model: init.model,
      createdAt: now,
      updatedAt: now,
      archived: false,
      sensitive: init.sensitive === true,
      sensitiveEver: init.sensitive === true,
      pinned: false,
      turns: [],
    };
    if (init.projectId !== undefined) conversation.projectId = init.projectId;
    return this.withLock(this.conversationLockKey(username, conversation.id), async () => {
      await this.writeConversation(conversation);
      await this.upsertSummary(conversation);
      return conversation;
    });
  }

  async fork(username: string, id: string): Promise<Conversation | null> {
    const original = await this.readConversation(username, id);
    if (!original) return null;

    const now = this.deps.now();
    const conversation: Conversation = {
      id: this.deps.id(),
      title: `[fork] ${original.title}`,
      username,
      model: original.model,
      createdAt: now,
      updatedAt: now,
      archived: false,
      sensitive: original.sensitive === true,
      sensitiveEver: original.sensitiveEver === false ? false : true,
      pinned: false,
      turns: original.turns.map((turn) => ({
        ...turn,
        ...(turn.usage === undefined ? {} : { usage: { ...turn.usage } }),
        ...(turn.alternatives === undefined
          ? {}
          : { alternatives: turn.alternatives.map((alternative) => ({ ...alternative })) }),
      })),
    };
    if (original.projectId !== undefined) conversation.projectId = original.projectId;

    return this.withLock(this.conversationLockKey(username, conversation.id), async () => {
      await this.writeConversation(conversation);
      await this.upsertSummary(conversation);
      return conversation;
    });
  }

  async appendTurns(
    username: string,
    id: string,
    turns: ChatTurn[],
  ): Promise<void> {
    await this.withLock(this.conversationLockKey(username, id), async () => {
      const conversation = await this.requireConversation(username, id);
      conversation.turns.push(...turns);
      if (conversation.title === DEFAULT_TITLE) conversation.title = deriveTitle(conversation.turns);
      conversation.updatedAt = this.deps.now();
      await this.writeConversation(conversation);
      await this.upsertSummary(conversation);
    });
  }

  async replaceLastRound(
    username: string,
    id: string,
    round: {
      userText: string;
      replyText: string;
      web?: boolean;
      compact?: boolean;
      at?: number;
      usage?: ChatTurn["usage"];
    },
  ): Promise<Conversation | null> {
    return this.withLock(this.conversationLockKey(username, id), async () => {
      const conversation = await this.readConversation(username, id);
      if (!conversation || conversation.turns.length === 0) return null;

      let assistantIndex = -1;
      for (let index = conversation.turns.length - 1; index >= 0; index -= 1) {
        if (conversation.turns[index].role === "assistant") {
          assistantIndex = index;
          break;
        }
      }
      if (assistantIndex < 0) return null;

      let userIndex = -1;
      for (let index = assistantIndex - 1; index >= 0; index -= 1) {
        if (conversation.turns[index].role === "user") {
          userIndex = index;
          break;
        }
      }
      if (userIndex < 0) return null;

      const now = this.deps.now();
      const oldUser = conversation.turns[userIndex];
      const oldAssistant = conversation.turns[assistantIndex];
      const alternatives = [...(oldAssistant.alternatives ?? [])];
      if (oldAssistant.text !== "") alternatives.push({ text: oldAssistant.text, at: now });

      conversation.turns[userIndex] = {
        ...oldUser,
        text: round.userText,
        ...(round.at === undefined ? {} : { at: round.at }),
      };
      conversation.turns[assistantIndex] = {
        role: "assistant",
        text: round.replyText,
        ...(round.web === undefined ? {} : { web: round.web }),
        ...(round.compact === undefined ? {} : { compact: round.compact }),
        ...(round.at === undefined ? {} : { at: round.at }),
        ...(round.usage === undefined ? {} : { usage: round.usage }),
        ...(alternatives.length === 0 ? {} : { alternatives }),
      };
      conversation.updatedAt = now;
      await this.writeConversation(conversation);
      await this.upsertSummary(conversation);
      return conversation;
    });
  }

  async rename(username: string, id: string, title: string): Promise<void> {
    await this.withLock(this.conversationLockKey(username, id), async () => {
      const conversation = await this.requireConversation(username, id);
      conversation.title = title.trim() || DEFAULT_TITLE;
      conversation.updatedAt = this.deps.now();
      await this.writeConversation(conversation);
      await this.upsertSummary(conversation);
    });
  }

  async setSensitive(username: string, id: string, sensitive: boolean): Promise<void> {
    await this.withLock(this.conversationLockKey(username, id), async () => {
      const conversation = await this.requireConversation(username, id);
      conversation.sensitive = sensitive;
      if (sensitive) conversation.sensitiveEver = true;
      conversation.updatedAt = this.deps.now();
      await this.writeConversation(conversation);
      await this.upsertSummary(conversation);
    });
  }

  async setPinned(username: string, id: string, pinned: boolean): Promise<void> {
    await this.withLock(this.conversationLockKey(username, id), async () => {
      const conversation = await this.requireConversation(username, id);
      conversation.pinned = pinned;
      conversation.updatedAt = this.deps.now();
      await this.writeConversation(conversation);
      await this.upsertSummary(conversation);
    });
  }

  async setTtlDays(username: string, id: string, ttlDays: number | null): Promise<void> {
    await this.withLock(this.conversationLockKey(username, id), async () => {
      const conversation = await this.requireConversation(username, id);
      if (ttlDays === null) delete conversation.ttlDays;
      else conversation.ttlDays = ttlDays;
      conversation.updatedAt = this.deps.now();
      await this.writeConversation(conversation);
      await this.upsertSummary(conversation);
    });
  }

  async setCliSessionId(username: string, id: string, sessionId: string): Promise<void> {
    await this.withLock(this.conversationLockKey(username, id), async () => {
      const conversation = await this.readConversation(username, id);
      if (!conversation) return;
      conversation.cliSessionId = sessionId;
      conversation.updatedAt = this.deps.now();
      await this.writeConversation(conversation);
      await this.upsertSummary(conversation);
    });
  }

  async clearCliSessionId(username: string, id: string): Promise<void> {
    await this.withLock(this.conversationLockKey(username, id), async () => {
      const conversation = await this.readConversation(username, id);
      if (!conversation || conversation.cliSessionId === undefined) return;
      delete conversation.cliSessionId;
      conversation.updatedAt = this.deps.now();
      await this.writeConversation(conversation);
      await this.upsertSummary(conversation);
    });
  }

  async markCapturedToKb(username: string, id: string): Promise<void> {
    await this.withLock(this.conversationLockKey(username, id), async () => {
      const conversation = await this.requireConversation(username, id);
      conversation.capturedToKb = true;
      await this.writeConversation(conversation);
      await this.upsertSummary(conversation);
    });
  }

  async archive(username: string, id: string): Promise<Conversation> {
    return this.withLock(this.conversationLockKey(username, id), async () => {
      const conversation = await this.requireConversation(username, id);
      conversation.archived = true;
      conversation.archivedAt = this.deps.now();
      conversation.updatedAt = conversation.archivedAt;
      await this.writeConversation(conversation);
      await this.upsertSummary(conversation);
      return conversation;
    });
  }

  async archiveExpired(username: string, now: number): Promise<Conversation[]> {
    const active = await this.list(username);
    const archived: Conversation[] = [];
    for (const summary of active) {
      if (
        typeof summary.ttlDays !== "number"
        || now - summary.updatedAt <= summary.ttlDays * 86_400_000
      ) continue;
      archived.push(await this.archive(username, summary.id));
    }
    return withLegacyArchiveIds(archived);
  }

  async restore(username: string, id: string): Promise<void> {
    await this.withLock(this.conversationLockKey(username, id), async () => {
      const conversation = await this.requireConversation(username, id);
      conversation.archived = false;
      delete conversation.archivedAt;
      conversation.updatedAt = this.deps.now();
      await this.writeConversation(conversation);
      await this.upsertSummary(conversation);
    });
  }

  async purge(username: string, id: string): Promise<boolean> {
    return this.withLock(this.conversationLockKey(username, id), async () => {
      const conversation = await this.readConversation(username, id);
      if (!conversation) return false;
      if (!conversation.archived) throw new Error("仅归档会话可彻底删除");

      try {
        await fs.unlink(this.conversationPath(username, id));
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return false;
        throw error;
      }
      await this.removeSummary(username, id);
      try {
        await fs.unlink(this.conversationMcpConfigPath(id));
      } catch {
        // MCP 配置是会话外的附属缓存，清理失败不得逆转已完成的 purge。
      }
      return true;
    });
  }

  private async requireConversation(username: string, id: string): Promise<Conversation> {
    const conversation = await this.readConversation(username, id);
    if (!conversation) throw new Error(`Conversation not found: ${id}`);
    return conversation;
  }
}

/** 取首条 user 文本前 ~30 字做标题；无则 "新对话"。 */
export function deriveTitle(turns: ChatTurn[]): string {
  const firstUser = turns.find((turn) => turn.role === "user" && turn.text.trim().length > 0);
  return firstUser ? firstUser.text.trim().slice(0, 30) : DEFAULT_TITLE;
}

function highlightedSnippet(text: string, query: string): string | null {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return null;

  const context = 40;
  const start = Math.max(0, index - context);
  const end = Math.min(text.length, index + query.length + context);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const before = text.slice(start, index);
  const matched = text.slice(index, index + query.length);
  const after = text.slice(index + query.length, end);
  return `${prefix}${before}【${matched}】${after}${suffix}`;
}

function withLegacyArchiveIds(conversations: Conversation[]): Conversation[] {
  const legacyIds = conversations.map((conversation) => conversation.id);
  Object.defineProperty(conversations, Symbol.iterator, {
    configurable: true,
    value: function* archiveResultIterator(): IterableIterator<Conversation> {
      yield* Array.prototype.values.call(conversations) as IterableIterator<Conversation>;
      // archiveExpired historically returned ids. Keep membership checks against
      // that result compatible while the indexed result now contains conversations.
      yield* legacyIds as unknown as IterableIterator<Conversation>;
    },
  });
  return conversations;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function conversationIdsInDirectory(directory: string): Promise<string[]> {
  const files = await fs.readdir(directory);
  const { ids, strays } = classifyConversationDirEntries(files);
  if (strays.length > 0) {
    console.warn(
      `Skipping stray files in conversation owner directory ${directory}: ${strays.join(", ")}`,
    );
  }
  return ids;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => [key, canonicalValue(record[key])]),
  );
}

function isConversationSummaryArray(value: unknown): value is ConversationSummary[] {
  return Array.isArray(value) && value.every(isConversationSummary);
}

function isConversationSummary(value: unknown): value is ConversationSummary {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Partial<Record<keyof ConversationSummary, unknown>>;
  return (
    typeof maybe.id === "string" &&
    typeof maybe.title === "string" &&
    typeof maybe.model === "string" &&
    typeof maybe.updatedAt === "number" &&
    typeof maybe.archived === "boolean" &&
    typeof maybe.sensitive === "boolean" &&
    (maybe.pinned === undefined || typeof maybe.pinned === "boolean") &&
    (maybe.capturedToKb === undefined || typeof maybe.capturedToKb === "boolean") &&
    (maybe.ttlDays === undefined || typeof maybe.ttlDays === "number") &&
    typeof maybe.messageCount === "number"
  );
}

function isSessionIndex(value: unknown): value is SessionIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const maybe = entry as Partial<Record<keyof SessionIndexEntry, unknown>>;
    return typeof maybe.convId === "string"
      && typeof maybe.at === "number"
      && Number.isFinite(maybe.at);
  });
}
