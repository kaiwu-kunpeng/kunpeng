/** 日志保尾截断：~/.kunpeng/logs 下的日志多由 launchd StandardOutPath 或被重定向的 stdout 持有 fd，
 *  绝不能 rename/unlink 轮转（服务会继续写进被弃置的 inode）。唯一安全做法是原地截断同一 inode
 *  （writeFileSync 走 O_TRUNC），保留末尾若干字节、按整行切。写入方以 append 打开时，截断后的新行照常落进同一文件。 */
import { closeSync, openSync, readdirSync, readSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LOG_TRIM_MAX_BYTES = 20 * 1024 * 1024;
export const LOG_TRIM_KEEP_BYTES = 5 * 1024 * 1024;

export interface LogTrimOptions {
  maxBytes?: number;
  keepBytes?: number;
  now?: () => Date;
}

export interface LogTrimResult {
  file: string;
  trimmed: boolean;
  before: number;
  after: number;
  error?: string;
}

/** 超过 maxBytes 才截：保留末尾 keepBytes（从其中第一个换行之后起，只留整行），文件头加一行截断说明。 */
export function trimLogFile(path: string, opts: LogTrimOptions = {}): LogTrimResult {
  const maxBytes = opts.maxBytes ?? LOG_TRIM_MAX_BYTES;
  const keepBytes = Math.min(opts.keepBytes ?? LOG_TRIM_KEEP_BYTES, maxBytes);
  const before = statSync(path).size;
  if (before <= maxBytes) return { file: path, trimmed: false, before, after: before };
  const start = before - keepBytes;
  const buffer = Buffer.alloc(keepBytes);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, keepBytes, start);
  } finally {
    closeSync(fd);
  }
  const firstNewline = buffer.indexOf(0x0a);
  const tail = firstNewline >= 0 ? buffer.subarray(firstNewline + 1) : buffer;
  const stamp = (opts.now ?? (() => new Date()))().toISOString();
  const header = Buffer.from(`[log-trim] ${stamp} 原 ${before} 字节，已原地截断、保留末尾 ${tail.length} 字节\n`);
  writeFileSync(path, Buffer.concat([header, tail]));
  return { file: path, trimmed: true, before, after: header.length + tail.length };
}

/** 截断目录下所有 *.log；单个文件失败记 error 不抛，其余照常处理。只返回截断了的与出错的。 */
export function trimLogDir(dir: string, opts: LogTrimOptions = {}): LogTrimResult[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const results: LogTrimResult[] = [];
  for (const name of names.filter((n) => n.endsWith(".log")).sort()) {
    const path = join(dir, name);
    try {
      if (!statSync(path).isFile()) continue;
      const result = trimLogFile(path, opts);
      if (result.trimmed) results.push(result);
    } catch (error) {
      results.push({ file: path, trimmed: false, before: 0, after: 0, error: String(error) });
    }
  }
  return results;
}
