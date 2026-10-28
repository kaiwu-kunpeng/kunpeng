import type { KunpengEvent } from "../sdk/events.js";
import type { DriverEvent, LoopHandle, RunLoop } from "./workspace-driver.js";

export type RunDevCycle = (
  workspaceId: string,
  message: string,
  onEvent: (e: KunpengEvent) => void,
  model?: string,
  signal?: AbortSignal,
) => Promise<void>;

export interface DevCycleRunLoopDeps {
  runDevCycle: RunDevCycle;
  onMerge: (flowId: string) => Promise<void>;
  onReject: (flowId: string) => Promise<void>;
}

const flowFailureStatuses = new Set(["rolled-back", "stopped", "blocked"]);

export function doneFailureReason(status: string): string {
  const normalized = typeof status === "string" ? status.trim() : "";
  switch (normalized) {
    case "rolled-back":
      return "任务未通过验证，已回滚（rolled-back）";
    case "stopped":
      return "任务被中止（stopped）";
    case "blocked":
      return "任务被阻塞（blocked）";
    case "":
      return "任务异常结束";
    default:
      return `任务未成功结束（${normalized}）`;
  }
}

class EventQueue implements AsyncIterable<DriverEvent> {
  private readonly queued: DriverEvent[] = [];
  private readonly waiters: Array<(result: IteratorResult<DriverEvent>) => void> = [];
  private closed = false;

  push(event: DriverEvent): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
      return;
    }
    this.queued.push(event);
  }

  close(): void {
    if (this.closed) return;
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
        if (this.queued.length > 0) {
          const value = this.queued.shift();
          if (value) return Promise.resolve({ value, done: false });
        }
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<DriverEvent>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

export function createDevCycleRunLoop(deps: DevCycleRunLoopDeps): RunLoop {
  const runLoop = ((workspaceId: string, message: string, model?: string): LoopHandle => {
    const ac = new AbortController();
    const queue = new EventQueue();
    let lastGateId = "";

    const onEvent = (event: KunpengEvent): void => {
      switch (event.type) {
        case "flow":
          queue.push({ type: "stage", stage: event.stage });
          if (flowFailureStatuses.has(event.status)) {
            queue.push({ type: "error", reason: doneFailureReason(event.status) });
          }
          break;
        case "token":
          queue.push({ type: "token", text: event.text });
          break;
        case "usage":
          queue.push({
            type: "usage",
            input: event.input,
            output: event.output,
            model: event.model,
          });
          break;
        case "gate": {
          const gateId = event.flowId ?? "";
          lastGateId = gateId;
          queue.push({
            type: "gate-needed",
            gateId,
            what: event.what,
            detail: event.detail,
          });
          break;
        }
        case "done":
          if (event.status === "verified") {
            queue.push({ type: "done" });
          } else {
            queue.push({ type: "error", reason: doneFailureReason(event.status) });
          }
          queue.close();
          break;
        case "phase":
          break;
      }
    };

    const answerGate = (gateId: string, decision: "yes" | "no"): void => {
      const flowId = gateId || lastGateId;
      const action = decision === "yes" ? deps.onMerge : deps.onReject;
      void action(flowId).catch((error: unknown) => {
        queue.push({ type: "error", reason: errorReason(error) });
      });
    };

    void (async () => {
      try {
        await deps.runDevCycle(workspaceId, message, onEvent, model, ac.signal);
      } catch (error: unknown) {
        queue.push({ type: "error", reason: errorReason(error) });
      } finally {
        queue.close();
      }
    })();

    return { events: queue, answerGate, abort: () => ac.abort() };
  }) as RunLoop & LoopHandle;

  let defaultHandle: LoopHandle | undefined;
  const ensureDefaultHandle = (): LoopHandle => {
    defaultHandle ??= runLoop("", "");
    return defaultHandle;
  };

  Object.defineProperties(runLoop, {
    events: {
      get: () => ensureDefaultHandle().events,
    },
    answerGate: {
      value: (gateId: string, decision: "yes" | "no") => {
        ensureDefaultHandle().answerGate(gateId, decision);
      },
    },
  });

  return runLoop;
}

function errorReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
