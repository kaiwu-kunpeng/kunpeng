import type { WorkspaceTranscript, TranscriptEntry } from "../runtime/workspace-transcript.js";

export type DriverEvent =
  | { type: "stage"; stage: string }
  | { type: "token"; text: string }
  | { type: "file-changed"; path: string; added?: number; removed?: number }
  | { type: "gate-needed"; gateId: string; what: string; detail?: string }
  | { type: "usage"; input?: number; output?: number; model?: string }
  | { type: "done"; summary?: string }
  | { type: "error"; reason: string };

export interface LoopHandle {
  /** loop 自身吐出的事件流。 */
  events: AsyncIterable<DriverEvent>;
  /** 远程对人工门的答复回灌 loop。 */
  answerGate(gateId: string, decision: "yes" | "no"): void;
  /** best-effort 中止当前运行。 */
  abort?(): void;
}

export type RunLoop = (workspaceId: string, message: string, model?: string) => LoopHandle;

export interface WorkspaceDriverOpts {
  runLoop: RunLoop;
  transcript: WorkspaceTranscript;
}

export type WorkspaceStatus = "idle" | "running" | "awaiting-gate";

interface WorkspaceState {
  handle: LoopHandle;
  status: WorkspaceStatus;
}

class EventQueue implements AsyncIterable<DriverEvent> {
  private readonly queued: DriverEvent[] = [];
  private readonly waiters: Array<(result: IteratorResult<DriverEvent>) => void> = [];
  private closed = false;

  push(event: DriverEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
      return;
    }
    this.queued.push(event);
  }

  close(): void {
    this.closed = true;
    for (;;) {
      const waiter = this.waiters.shift();
      if (!waiter) break;
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<DriverEvent> {
    return {
      next: () => {
        const value = this.queued.shift();
        if (value) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<DriverEvent>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

export class WorkspaceDriver {
  private readonly runLoop: RunLoop;
  private readonly transcript: WorkspaceTranscript;
  private readonly states = new Map<string, WorkspaceState>();

  constructor(opts: WorkspaceDriverOpts) {
    this.runLoop = opts.runLoop;
    this.transcript = opts.transcript;
  }

  /**
   * 起一轮:调 runLoop 拿 handle,**主动 pump** handle.events——
   * 每个事件落 transcript 并入内部队列;遇 gate-needed 置 awaiting-gate;
   * 流结束置 idle。返回的异步迭代器从队列读(空则等待)。
   */
  say(workspaceId: string, message: string, model?: string): AsyncIterable<DriverEvent> {
    const prev = this.states.get(workspaceId);
    if (prev && prev.status !== "idle") {
      try {
        prev.handle.abort?.();
      } catch {
        /* best-effort:旧孤儿中止失败不阻塞新请求 */
      }
    }
    const handle = this.runLoop(workspaceId, message, model);
    const queue = new EventQueue();
    this.states.set(workspaceId, { handle, status: "running" });
    void this.pump(workspaceId, handle, queue);
    return queue;
  }

  /** 委托当前 handle.answerGate;置回 running。 */
  answerGate(workspaceId: string, gateId: string, decision: "yes" | "no"): void {
    const state = this.states.get(workspaceId);
    if (!state) throw new Error(`workspace is not running: ${workspaceId}`);
    state.handle.answerGate(gateId, decision);
    state.status = "running";
  }

  abort(workspaceId: string): void {
    try {
      this.states.get(workspaceId)?.handle.abort?.();
    } catch {
      /* best-effort:调用方断开时不让中止异常外溢 */
    }
  }

  getTranscript(workspaceId: string, sinceSeq?: number): TranscriptEntry[] {
    return this.transcript.get(workspaceId, sinceSeq);
  }

  status(workspaceId: string): WorkspaceStatus {
    return this.states.get(workspaceId)?.status ?? "idle";
  }

  private async pump(workspaceId: string, handle: LoopHandle, queue: EventQueue): Promise<void> {
    try {
      for await (const event of handle.events) {
        this.transcript.append(workspaceId, event.type, event);
        queue.push(event);
        if (event.type === "gate-needed") {
          const state = this.states.get(workspaceId);
          if (state?.handle === handle) state.status = "awaiting-gate";
        }
      }
    } catch (error: unknown) {
      const event: DriverEvent = { type: "error", reason: errorReason(error) };
      this.transcript.append(workspaceId, event.type, event);
      queue.push(event);
    } finally {
      const state = this.states.get(workspaceId);
      if (state?.handle === handle) state.status = "idle";
      queue.close();
    }
  }
}

function errorReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
