import { join } from "node:path";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { kunpengStateDir } from "../project/state-dir.js";
import { evictOldest } from "./workspace-driver-deps.js";
import { extractToSidecar, officeKind } from "./upload-extract.js";

type UploadRecord = { path: string; name: string; image: boolean; extractedPath?: string };
type UploadKind = "image" | "file";

const MAX_UPLOADS = 200;

// 粘贴/上传的附件:id → 本机绝对路径与原始名(避免客户端直接传任意路径喂模型)。
const uploads = new Map<string, UploadRecord>();
export const UPLOAD_DIR = join(kunpengStateDir(), "uploads");
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const FILE_EXTS = new Set(["pptx", "ppt", "xlsx", "xls", "csv", "docx", "doc", "pdf", "txt", "md", "json"]);
const IMAGE_LIMIT_BYTES = 24 * 1024 * 1024;
const FILE_LIMIT_BYTES = 50 * 1024 * 1024;

export async function gcUploads(
  dir: string,
  maxAgeMs: number,
  now: () => number = Date.now,
): Promise<number> {
  try {
    const names = await readdir(dir);
    let removed = 0;
    for (const name of names) {
      const path = join(dir, name);
      try {
        const file = await stat(path);
        if (now() - file.mtimeMs > maxAgeMs) {
          await unlink(path);
          removed += 1;
        }
      } catch {
        // 单个条目损坏或并发消失不应阻断其余附件清理。
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

function normalizeUploadExt(value: string): string {
  const ext = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext === "jpeg" ? "jpg" : ext;
}

function extFromName(name: string): string {
  const base = name.trim().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return "";
  return normalizeUploadExt(base.slice(dot + 1));
}

function imageExtFromMime(mime: string): string {
  if (mime === "image/svg+xml") return "svg";
  if (!mime.startsWith("image/")) return "";
  return normalizeUploadExt(mime.slice("image/".length).replace(/\+xml$/, ""));
}

/** 接收 base64 dataURL 附件,落盘到 ~/.kunpeng/uploads,返回 id(供 chat 引用)。 */
export async function handleUpload(body: Record<string, unknown>): Promise<{ ok: boolean; id?: string; name?: string; kind?: UploadKind; error?: string }> {
  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) return { ok: false, error: "需要 base64 dataURL" };
  const originalName = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
  const ext = extFromName(originalName) || imageExtFromMime(m[1]);
  if (!ext) return { ok: false, error: "不支持的文件类型" };
  const image = IMAGE_EXTS.has(ext);
  const kind: UploadKind | undefined = image ? "image" : FILE_EXTS.has(ext) ? "file" : undefined;
  if (!kind) return { ok: false, error: `不支持的文件类型: .${ext}` };
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > (image ? IMAGE_LIMIT_BYTES : FILE_LIMIT_BYTES)) {
    return { ok: false, error: image ? "图片过大(>24MB)" : "文件过大(>50MB)" };
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  const id = randomUUID();
  const abs = join(UPLOAD_DIR, `${id}.${ext}`);
  await writeFile(abs, buf);
  const name = originalName || (image ? `image.${ext}` : `upload.${ext}`);
  let extractedPath: string | undefined;
  try {
    if (officeKind(name)) extractedPath = await extractToSidecar(abs, name) ?? undefined;
  } catch {
    extractedPath = undefined;
  }
  uploads.set(id, { path: abs, name, image, ...(extractedPath ? { extractedPath } : {}) });
  evictOldest(uploads, MAX_UPLOADS, (_id, rec) => {
    void unlink(rec.path).catch(() => {});
    if (rec.extractedPath) void unlink(rec.extractedPath).catch(() => {});
  });
  return { ok: true, id, name, kind };
}

export function resolveUploads(ids: string[]): { images: string[]; files: { path: string; name: string; extractedPath?: string }[] } {
  const images: string[] = [];
  const files: { path: string; name: string; extractedPath?: string }[] = [];
  for (const id of ids) {
    const upload = uploads.get(id);
    if (!upload) continue;
    if (upload.image) images.push(upload.path);
    else files.push({
      path: upload.path,
      name: upload.name,
      ...(upload.extractedPath ? { extractedPath: upload.extractedPath } : {}),
    });
  }
  return { images, files };
}

export function composeUserMessage(message: string, imagePaths: string[], files: { path: string; name: string; extractedPath?: string }[], codex: boolean): string {
  const parts = [message];
  if (!codex && imagePaths.length) {
    parts.push(`请查看这些图片:\n${imagePaths.join("\n")}`);
  }
  if (files.length) {
    const browserExtracted = files.filter((f) => f.name.toLowerCase().endsWith(".extracted.txt"));
    const originalFiles = files.filter((f) => !f.name.toLowerCase().endsWith(".extracted.txt"));
    if (browserExtracted.length) {
      parts.push(`请直接读取以下浏览器端已提取文本后再回答:\n${browserExtracted.map((f) => `- ${f.name}(浏览器端已提取的文本,直接读取): ${f.path}`).join("\n")}`);
    }
    if (originalFiles.length) parts.push(`请先读取并解析以下上传文件内容后再回答。pptx/xlsx/docx 等 Office 文档可用 python 等命令行工具解析:\n${originalFiles.map((f) => f.extractedPath
      ? `- ${f.name}(已预提取文本,直接读取:${f.extractedPath};原件 ${f.path} 勿自行解析)`
      : `- ${f.name} → ${f.path}`).join("\n")}`);
  }
  return parts.filter((p) => p.trim()).join("\n\n");
}
