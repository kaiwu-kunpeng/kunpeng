import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { PresenceStore } from "../../switchboard/presence.js";
import { reapDeadTasks } from "../../taskboard/reaper.js";
import { TaskBoard } from "../../taskboard/store.js";
import { currentProfileId } from "../auth-context.js";
import { registerModularRoute, type RouteContext } from "./registry.js";
import { errorMessage } from "../../util/errors.js";

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_STALE_MINUTES = 10;
const TASK_ID_PATTERN = /^[1-9]\d*$/;

class InputError extends Error {}

function sendJson(res: ServerResponse, value: unknown): void {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}

async function readTaskboardJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    req.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        reject(new InputError("请求体过大"));
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new InputError("JSON 对象格式非法");
        }
        resolve(parsed as Record<string, unknown>);
      } catch (error) {
        reject(error instanceof InputError ? error : new InputError("JSON 请求体格式非法"));
      }
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InputError(`${field} 必须是非空字符串`);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new InputError(`${field} 必须是字符串`);
  return value;
}

function taskId(body: Record<string, unknown>, field = "id"): string {
  const value = requiredString(body, field);
  if (!TASK_ID_PATTERN.test(value)) throw new InputError(`${field} 必须是正整数任务 ID`);
  return value;
}

function optionalBlockedBy(body: Record<string, unknown>): string[] | undefined {
  const value = body.blockedBy;
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string" && TASK_ID_PATTERN.test(id))) {
    throw new InputError("blockedBy 必须是正整数任务 ID 数组");
  }
  return value;
}

function staleMilliseconds(body: Record<string, unknown>): number {
  const value = body.staleMin ?? DEFAULT_STALE_MINUTES;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new InputError("staleMin 必须是正有限数");
  }
  const milliseconds = value * 60_000;
  if (!Number.isSafeInteger(milliseconds)) throw new InputError("staleMin 超出安全范围");
  return milliseconds;
}

function isExpectedTaskError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return [
    "无效任务 ID:",
    "无效依赖任务 ID:",
    "任务不存在或数据损坏:",
    "任务非 pending:",
    "任务非 in_progress:",
    "任务被阻塞:",
    "完成门拒绝:",
  ].some((prefix) => error.message.startsWith(prefix));
}

async function runBusinessAction(res: ServerResponse, action: () => Promise<unknown>): Promise<void> {
  try {
    sendJson(res, await action());
  } catch (error) {
    if (error instanceof InputError || isExpectedTaskError(error)) {
      sendJson(res, { ok: false, error: errorMessage(error) });
      return;
    }
    throw error;
  }
}

function boardFor(context: RouteContext, completedGates = false): TaskBoard {
  const boardDir = join(context.stateDir, "taskboard", currentProfileId() ?? "home");
  return completedGates
    ? new TaskBoard(boardDir, Date.now, { completedGatesDir: join(boardDir, "gates.d") })
    : new TaskBoard(boardDir);
}

registerModularRoute({
  method: "GET",
  path: "/api/taskboard",
  handle: async (_req, res, url, context) => {
    const projectId = new URL(url, "http://localhost").searchParams.get("projectId")?.trim();
    const tasks = await boardFor(context).list();
    sendJson(res, { tasks: projectId ? tasks.filter((task) => task.projectId === projectId) : tasks });
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/taskboard/create",
  handle: async (req, res, _url, context) => {
    await runBusinessAction(res, async () => {
      const body = await readTaskboardJsonBody(req);
      const projectId = optionalString(body, "projectId")?.trim();
      return boardFor(context).create({
        subject: requiredString(body, "subject"),
        description: optionalString(body, "description"),
        blockedBy: optionalBlockedBy(body),
        ...(projectId ? { projectId } : {}),
        createdBy: body.createdBy === undefined ? "cockpit" : requiredString(body, "createdBy"),
      });
    });
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/taskboard/claim",
  handle: async (req, res, _url, context) => {
    await runBusinessAction(res, async () => {
      const body = await readTaskboardJsonBody(req);
      return boardFor(context).claim(taskId(body), requiredString(body, "owner"));
    });
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/taskboard/complete",
  handle: async (req, res, _url, context) => {
    await runBusinessAction(res, async () => {
      const body = await readTaskboardJsonBody(req);
      return boardFor(context, true).complete(taskId(body));
    });
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/taskboard/reap",
  handle: async (req, res, _url, context) => {
    await runBusinessAction(res, async () => {
      const body = await readTaskboardJsonBody(req);
      const released = await reapDeadTasks(
        boardFor(context),
        new PresenceStore(join(context.stateDir, "presence")),
        Date.now(),
        staleMilliseconds(body),
      );
      return { released };
    });
  },
});
