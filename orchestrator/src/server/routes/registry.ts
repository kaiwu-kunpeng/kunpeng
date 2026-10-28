import type { IncomingMessage, ServerResponse } from "node:http";
import type { WeakPoint } from "../../loop/recipe.js";
import type { SpawnFn } from "../launch.js";

export interface RouteContext {
  repoRoot?: string;
  stateDir: string;
  execPath?: string;
  cliJs?: string;
  spawn?: SpawnFn;
  loopWeakPoints?: (loopId: string, repoRoot: string) => Promise<WeakPoint[]>;
}

export interface ModularRoute {
  method: string;
  path: string;
  handle: (req: IncomingMessage, res: ServerResponse, url: string, context: RouteContext) => void | Promise<void>;
}

const routes: ModularRoute[] = [];

function normalizeMethod(method: string): string {
  return method.toUpperCase();
}

export function registerModularRoute(route: ModularRoute): void {
  const normalized = { ...route, method: normalizeMethod(route.method) };
  const existing = routes.findIndex((candidate) =>
    candidate.method === normalized.method && candidate.path === normalized.path);
  if (existing >= 0) routes[existing] = normalized;
  else routes.push(normalized);
}

export async function dispatchModularRoute(
  method: string,
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
  context: RouteContext,
): Promise<boolean> {
  const path = url.split("?")[0];
  const route = routes.find((candidate) =>
    candidate.method === normalizeMethod(method) && candidate.path === path);
  if (!route) return false;
  await route.handle(req, res, url, context);
  return true;
}

export function listModularRoutes(): ModularRoute[] {
  return [...routes];
}
