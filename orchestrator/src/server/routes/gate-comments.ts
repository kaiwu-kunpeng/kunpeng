import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectStateDir } from "../../project/state-resolve.js";
import { appendComment, composeSendbackSpec, readComments, type GateComment } from "../gate-sendback.js";
import { registerModularRoute, type RouteContext } from "./registry.js";
import { errorMessage } from "../../util/errors.js";
import { readJsonObjectStrict } from "../read-body.js";

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}

function validPlanId(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= 200
    && !/[\\/\0\r\n]/.test(value)
    && value !== "."
    && value !== "..";
}

function validFile(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 1000) return false;
  if (value.startsWith("/") || /[\0\r\n]/.test(value)) return false;
  return !value.split("/").some((part) => part === ".." || part.length === 0);
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 32 * 1024;
}

function projectStateDir(context: RouteContext): string {
  return resolveProjectStateDir(context.repoRoot ?? process.cwd(), { stateDir: context.stateDir });
}

function launchPlan(cliPath: string, specPath: string, repo: string): Promise<void> {
  return new Promise((resolveLaunch, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [cliPath, "plan", specPath, "--repo", repo], {
      cwd: repo,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, KUNPENG_BACKEND: "codex" },
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolveLaunch();
    });
  });
}

async function handleAppend(req: IncomingMessage, res: ServerResponse, _url: string, context: RouteContext): Promise<void> {
  try {
    const body = await readJsonObjectStrict(req, MAX_BODY_BYTES);
    if (!validPlanId(body.planId) || !validFile(body.file) || !validText(body.text)) {
      sendJson(res, 400, { ok: false, error: "planId、file、text 参数无效" });
      return;
    }
    const comment: GateComment = { planId: body.planId, file: body.file, text: body.text, at: Date.now() };
    await appendComment(projectStateDir(context), comment);
    sendJson(res, 200, { ok: true, comment });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: errorMessage(error) });
  }
}

async function handleRead(res: ServerResponse, url: string, context: RouteContext): Promise<void> {
  const planId = new URL(url, "http://127.0.0.1").searchParams.get("planId");
  if (!validPlanId(planId)) {
    sendJson(res, 400, { ok: false, error: "planId 参数无效" });
    return;
  }
  try {
    const comments = await readComments(projectStateDir(context), planId);
    sendJson(res, 200, { ok: true, comments });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: errorMessage(error) });
  }
}

async function handleSendback(req: IncomingMessage, res: ServerResponse, _url: string, context: RouteContext): Promise<void> {
  try {
    const body = await readJsonObjectStrict(req, MAX_BODY_BYTES);
    if (!validPlanId(body.planId)) {
      sendJson(res, 400, { ok: false, error: "planId 参数无效" });
      return;
    }
    const stateDir = projectStateDir(context);
    const comments = await readComments(stateDir, body.planId);
    if (comments.length === 0) {
      sendJson(res, 409, { ok: false, error: "没有评论" });
      return;
    }
    const specPath = join(stateDir, "gate-comments", `sendback-${body.planId}.md`);
    await writeFile(specPath, composeSendbackSpec(body.planId, comments), "utf8");
    const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "cli.js");
    await launchPlan(cliPath, specPath, context.repoRoot ?? process.cwd());
    sendJson(res, 200, { ok: true, spec: specPath, launched: true });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: errorMessage(error), launched: false });
  }
}

registerModularRoute({ method: "POST", path: "/api/gate-comments", handle: handleAppend });
registerModularRoute({
  method: "GET",
  path: "/api/gate-comments",
  handle: (_req, res, url, context) => handleRead(res, url, context),
});
registerModularRoute({ method: "POST", path: "/api/gate-comments/sendback", handle: handleSendback });
