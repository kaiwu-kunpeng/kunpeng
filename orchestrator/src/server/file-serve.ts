import type { ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat, readdir, realpath } from "node:fs/promises";
import { resolve, sep, extname, basename, join } from "node:path";

/** target 是否在 base 目录内（含 base 本身）。用于 realpath 后再核一遍，堵住 base 内软链指向 base 外。 */
export function isPathWithinBase(base: string, target: string): boolean {
  const b = resolve(base);
  const t = resolve(target);
  return t === b || t.startsWith(b + sep);
}

/** safeResolve + realpath 双校验：解析软链后仍必须落在 baseRoot 内，否则 null。文件不存在→抛（调用方按 404 处理）。 */
async function realWithinBase(baseRoot: string, full: string): Promise<string | null> {
  const realBase = await realpath(resolve(baseRoot)).catch(() => resolve(baseRoot));
  const real = await realpath(full);
  return isPathWithinBase(realBase, real) ? real : null;
}

/** 浏览器能内联打开的类型 → inline;Office/二进制 → attachment 下载。 */
const INLINE: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html",
  ".pdf": "application/pdf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp",
  ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".csv": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8", ".xml": "text/plain; charset=utf-8",
  ".js": "text/plain; charset=utf-8", ".ts": "text/plain; charset=utf-8", ".css": "text/plain; charset=utf-8",
};
const DOWNLOAD_MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".doc": "application/msword", ".ppt": "application/vnd.ms-powerpoint", ".xls": "application/vnd.ms-excel",
  ".zip": "application/zip",
};

/** 把用户给的相对路径锁进 baseRoot 内(防 ../ 穿越);非法返回 null。 */
export function safeResolve(baseRoot: string, rel: string): string | null {
  const base = resolve(baseRoot);
  const full = resolve(base, decodeURIComponent(rel || "."));
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

function dispositionHeader(name: string, attachment: boolean): string {
  const kind = attachment ? "attachment" : "inline";
  return `${kind}; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** 打开/下载工作区内一个文件。disp='download' 强制下载;默认按类型决定 inline/attachment。 */
export async function serveFile(
  res: ServerResponse, baseRoot: string, rel: string, disp?: string,
): Promise<void> {
  const resolved = safeResolve(baseRoot, rel);
  if (!resolved) { res.statusCode = 403; res.end("forbidden"); return; }
  let full: string;
  try {
    const real = await realWithinBase(baseRoot, resolved);
    if (!real) { res.statusCode = 403; res.end("forbidden"); return; }
    full = real;
  } catch { res.statusCode = 404; res.end("not found"); return; }
  let st;
  try { st = await stat(full); } catch { res.statusCode = 404; res.end("not found"); return; }
  if (st.isDirectory()) { res.statusCode = 400; res.end("is a directory"); return; }

  const ext = extname(full).toLowerCase();
  const name = basename(full);
  const inlineType = INLINE[ext];
  const forceDownload = disp === "download" || (!inlineType);
  const ctype = inlineType ?? DOWNLOAD_MIME[ext] ?? "application/octet-stream";

  res.setHeader("content-type", ctype);
  res.setHeader("content-length", String(st.size));
  res.setHeader("content-disposition", dispositionHeader(name, forceDownload));
  // HTML 内联:沙箱化(opaque origin,拿不到 cockpit 鉴权 cookie),防生成内容里的 JS 窃凭据。
  if (!forceDownload && (ext === ".html" || ext === ".htm")) {
    res.setHeader("content-security-policy", "sandbox allow-scripts allow-popups allow-forms;");
  }
  createReadStream(full).on("error", () => { if (!res.headersSent) res.statusCode = 500; res.end(); }).pipe(res);
}

export interface FileEntry { name: string; path: string; dir: boolean; size: number }

/** 列目录(锁在 baseRoot 内);用于 /files 浏览。 */
export async function listDir(baseRoot: string, relDir: string): Promise<{ ok: boolean; dir?: string; entries?: FileEntry[]; error?: string }> {
  const resolved = safeResolve(baseRoot, relDir || ".");
  if (!resolved) return { ok: false, error: "forbidden" };
  let full: string;
  try {
    const real = await realWithinBase(baseRoot, resolved);
    if (!real) return { ok: false, error: "forbidden" };
    full = real;
  } catch { return { ok: false, error: "not found" }; }
  let items;
  try { items = await readdir(full, { withFileTypes: true }); } catch { return { ok: false, error: "not found" }; }
  const base = await realpath(resolve(baseRoot)).catch(() => resolve(baseRoot));
  const entries: FileEntry[] = [];
  for (const it of items) {
    if (it.name.startsWith(".")) continue; // 跳隐藏(.git/.kunpeng 等)
    const abs = join(full, it.name);
    const relPath = abs.slice(base.length + 1);
    let size = 0;
    try { size = (await stat(abs)).size; } catch { /* skip */ }
    entries.push({ name: it.name, path: relPath, dir: it.isDirectory(), size });
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { ok: true, dir: relDir || ".", entries };
}
