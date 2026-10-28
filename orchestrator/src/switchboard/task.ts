import { kindOf, compareByTsThenId, type SwitchMessage } from "./store.js";

export type Role = "user" | "agent";

export type Part =
  | { kind: "text"; text: string }
  | { kind: "data"; data: unknown }
  | { kind: "file"; uri: string; mimeType?: string };

export type TaskState = "submitted" | "working" | "input-required" | "completed" | "canceled" | "failed" | "rejected";

const TERMINAL_STATES = ["completed", "canceled", "failed", "rejected"] as const;

export interface TaskStatus {
  state: TaskState;
  ts: number;
  note?: string;
}

export interface TaskMessage {
  id: string;
  role: Role;
  from: string;
  to: string;
  taskId: string;
  parts: Part[];
  ts: number;
  read: boolean;
}

export interface Task {
  id: string;
  state: TaskState;
  status: TaskStatus;
  history: TaskMessage[];
  assignee?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export function partsFromBody(body: string): Part[] {
  return [{ kind: "text", text: body }];
}

export function bodyFromParts(parts: Part[]): string {
  return parts
    .map((part) => {
      if (part.kind === "text") return part.text;
      if (part.kind === "data") return JSON.stringify(part.data);
      return part.uri;
    })
    .join("\n");
}

export type TaskEvent = "start" | "need-input" | "complete" | "cancel" | "fail" | "reject";

export function isTerminal(state: TaskState): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

export function nextState(current: TaskState, event: TaskEvent): TaskState {
  if (isTerminal(current)) return current;

  const transitions: Record<TaskEvent, TaskState> = {
    start: "working",
    "need-input": "input-required",
    complete: "completed",
    cancel: "canceled",
    fail: "failed",
    reject: "rejected",
  };

  return transitions[event];
}

export function deriveTask(taskId: string, messages: SwitchMessage[]): Task | null {
  const thread = [...messages.filter((message) => message.id === taskId || message.topic === taskId)].sort(compareByTsThenId);

  if (thread.length === 0) return null;

  const root = thread.find((message) => message.id === taskId) ?? thread[0];
  const history = thread.map((message): TaskMessage => ({
    id: message.id,
    role: message.from === root.from ? "user" : "agent",
    from: message.from,
    to: message.to,
    taskId,
    parts: partsFromBody(message.body),
    ts: message.ts,
    read: message.read,
  }));

  let state: TaskState = "submitted";
  if (thread.length > 1) state = nextState(state, "start");
  for (const message of thread) {
    const kind = kindOf(message);
    if (kind === "stop") state = nextState(state, "cancel");
    else if (kind === "receipt") state = nextState(state, "complete");
    else if (kind === "failure") state = nextState(state, "fail");
  }

  const last = thread[thread.length - 1];

  return {
    id: taskId,
    state,
    status: { state, ts: last.ts },
    history,
    createdBy: root.from,
    createdAt: root.ts,
    updatedAt: last.ts,
  };
}
