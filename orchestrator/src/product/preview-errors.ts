import { open } from "node:fs/promises";
import { join } from "node:path";
import { productLoopDir } from "./loop-store.js";

const PREVIEW_LOG_TAIL_BYTES = 64 * 1024;
const PREVIEW_ERROR_RE = /\b(error|failed|exception|eaddrinuse|enoent|cannot find)\b/i;
const PREVIEW_ERROR_MAX_CHARS = 200;

export async function readPreviewErrors(repoRoot: string, slug: string, limit = 5): Promise<string[]> {
  const maxLines = Math.max(0, Math.trunc(limit));
  if (maxLines === 0) return [];

  try {
    const path = join(productLoopDir(repoRoot, slug), "preview.log");
    const handle = await open(path, "r");
    try {
      const stat = await handle.stat();
      const length = Math.min(stat.size, PREVIEW_LOG_TAIL_BYTES);
      const offset = Math.max(0, stat.size - length);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);

      const seen = new Set<string>();
      const errors: string[] = [];
      for (const rawLine of buffer.toString("utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!PREVIEW_ERROR_RE.test(line) || seen.has(line)) continue;
        seen.add(line);
        errors.push(line);
      }

      return errors.slice(-maxLines).map((line) => line.slice(0, PREVIEW_ERROR_MAX_CHARS));
    } finally {
      await handle.close().catch((error: unknown) => {
        console.warn("预览日志文件关闭失败", { path, slug, error });
      });
    }
  } catch {
    return [];
  }
}
