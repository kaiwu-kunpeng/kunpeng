import * as fs from "node:fs/promises";
import { join } from "node:path";

export type SwitchMessageKind =
  | "msg"
  | "stop"
  | "receipt"
  | "task"
  | "idle_notification"
  | "failure"
  | "task_assignment"
  | "plan_approval_request"
  | "plan_approval_response"
  | "shutdown_request"
  | "shutdown_response";

const SWITCH_MESSAGE_KINDS = new Set<SwitchMessageKind>([
  "msg",
  "stop",
  "receipt",
  "task",
  "idle_notification",
  "failure",
  "task_assignment",
  "plan_approval_request",
  "plan_approval_response",
  "shutdown_request",
  "shutdown_response",
]);

/** 消息来源：人手发送、自动体、定时任务或外部通道。 */
export interface SwitchMessageOrigin {
  kind: "human" | "agent" | "schedule" | "channel";
}

export interface SwitchMessage {
  id: string;
  from: string;
  to: string;
  topic?: string;
  body: string;
  ts: number;
  read: boolean;
  urgent?: boolean;
  kind?: SwitchMessageKind;
  payload?: Record<string, unknown>;
  origin?: SwitchMessageOrigin;
}

/** On-disk messages may predate read/kind; list() normalizes them for current consumers. */
export type StoredSwitchMessage = Omit<SwitchMessage, "read" | "kind"> & {
  read?: boolean;
  kind?: unknown;
};

export interface NewMessageInput {
  from: string;
  to: string;
  topic?: string;
  body: string;
  urgent?: boolean;
  kind?: SwitchMessageKind;
  payload?: Record<string, unknown>;
  origin?: SwitchMessageOrigin;
}

export interface SwitchboardSender {
  send(input: NewMessageInput): Promise<unknown> | unknown;
}

export type SwitchDeps = {
  now: () => number;
  id: () => string;
};

export type FileSystem = Pick<typeof fs, "access" | "mkdir" | "readFile" | "readdir" | "writeFile">;

export function kindOf(msg: { kind?: unknown }): SwitchMessageKind {
  return typeof msg.kind === "string" && SWITCH_MESSAGE_KINDS.has(msg.kind as SwitchMessageKind)
    ? msg.kind as SwitchMessageKind
    : "msg";
}

export function compareByTsThenId(a: { ts: number; id: string }, b: { ts: number; id: string }): number {
  return a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function newMessage(input: NewMessageInput, deps: SwitchDeps): SwitchMessage {
  return {
    id: deps.id(),
    from: input.from,
    to: input.to,
    topic: input.topic,
    body: input.body,
    ts: deps.now(),
    read: false,
    ...(input.urgent ? { urgent: true } : {}),
    ...(input.kind && input.kind !== "msg" ? { kind: input.kind } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
    ...(input.origin ? { origin: input.origin } : {}),
  };
}

export class SwitchboardStore {
  constructor(private dir: string, private io: FileSystem = fs) {}

  private path(id: string): string {
    return join(this.dir, `${encodeURIComponent(id)}.json`);
  }

  async append(msg: SwitchMessage): Promise<boolean> {
    await this.io.mkdir(this.dir, { recursive: true });
    try {
      await this.io.writeFile(this.path(msg.id), `${JSON.stringify(msg, null, 2)}\n`, {
        flag: "wx",
      });
      return true;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
        return false;
      }
      throw error;
    }
  }

  async list(): Promise<SwitchMessage[]> {
    const files = (await this.io.readdir(this.dir).catch(() => [] as string[])).filter((file) => file.endsWith(".json"));
    const parsed = await Promise.all(files.map(async (file) => {
      try {
        const stored = JSON.parse(await this.io.readFile(join(this.dir, file), "utf8")) as StoredSwitchMessage;
        return { ...stored, read: stored.read === true } as SwitchMessage;
      } catch {
        console.warn(`[switchboard-store] 跳过无法解析的文件: ${file}`);
        return null;
      }
    }));

    return parsed
      .filter((msg): msg is SwitchMessage => msg !== null)
      .sort(compareByTsThenId);
  }

  async inbox(to: string, opts?: { unreadOnly?: boolean }): Promise<SwitchMessage[]> {
    return (await this.list()).filter((msg) => {
      if (msg.to !== to && msg.to !== "all") return false;
      if (opts?.unreadOnly === true && msg.read === true) return false;
      return true;
    });
  }

  async pendingStops(to: string): Promise<SwitchMessage[]> {
    const messages = await this.list();
    const receipted = new Set(
      messages
        .filter((msg) => kindOf(msg) === "receipt" && msg.from === to && msg.topic !== undefined)
        .map((msg) => msg.topic),
    );

    return messages.filter((msg) => {
      if (kindOf(msg) !== "stop") return false;
      if (msg.to !== to && msg.to !== "all") return false;
      return !receipted.has(msg.id);
    });
  }

  async markRead(id: string): Promise<SwitchMessage | null> {
    const raw = await this.io.readFile(this.path(id), "utf8").catch((error) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    });
    if (raw === null) return null;

    const stored = JSON.parse(raw) as StoredSwitchMessage;
    const cur = { ...stored, read: stored.read === true } as SwitchMessage;
    if (cur.read === true) return cur;

    const next: SwitchMessage = { ...cur, read: true };
    await this.io.writeFile(this.path(id), `${JSON.stringify(next, null, 2)}\n`, {
      flag: "w",
    });
    return next;
  }
}

/** Mark only the requested messages, preserving missing IDs as a no-op. */
export async function markRead(
  store: Pick<SwitchboardStore, "markRead">,
  ids: readonly string[],
): Promise<SwitchMessage[]> {
  const messages = await Promise.all(ids.map((id) => store.markRead(id)));
  return messages.filter((message): message is SwitchMessage => message !== null);
}
