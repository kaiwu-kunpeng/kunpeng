import { readFileSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, isAbsolute, join, relative, sep } from "node:path";

export function loadPublicReports(stateDir: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(stateDir, "public-reports.json"), "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const reports: Record<string, string> = {};
    for (const [slug, name] of Object.entries(parsed)) {
      if (/^[a-z0-9][a-z0-9-]{0,63}$/.exec(slug)?.[0] !== slug) continue;
      if (typeof name !== "string" || !name.endsWith(".html") || basename(name) !== name || name.includes("..")) continue;
      reports[slug] = name;
    }
    return reports;
  } catch {
    return {};
  }
}

export function matchPublicReport(method: string, path: string, map: Record<string, string>): string | null {
  if (method !== "GET" && method !== "HEAD") return null;
  const match = /^\/r\/([a-z0-9][a-z0-9-]{0,63})$/.exec(path);
  if (!match || match[0] !== path || !Object.hasOwn(map, match[1])) return null;
  return map[match[1]];
}

export async function tryServePublicReport(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { stateDir: string; docsDir: string; path: string },
): Promise<boolean> {
  const name = matchPublicReport(req.method ?? "GET", opts.path, loadPublicReports(opts.stateDir));
  if (name === null) return false;

  let content: Buffer;
  try {
    const root = await realpath(opts.docsDir);
    const file = await realpath(join(root, name));
    const within = relative(root, file);
    if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
      throw new Error("report outside docs directory");
    }
    content = await readFile(file);
  } catch {
    res.statusCode = 404;
    res.end("not found");
    return true;
  }

  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("x-robots-tag", "noindex, nofollow");
  res.setHeader("cache-control", "no-store");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(req.method === "HEAD" ? undefined : content);
  return true;
}
