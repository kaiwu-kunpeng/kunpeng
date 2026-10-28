import { closeSync, openSync, readSync, statSync, writeFileSync } from "node:fs";

export interface LogCapOptions {
  maxBytes: number;
  keepBytes: number;
}

export interface LogCapResult {
  capped: boolean;
  droppedBytes: number;
}

function notCapped(): LogCapResult {
  return { capped: false, droppedBytes: 0 };
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export function capLogFile(path: string, opts: LogCapOptions): LogCapResult {
  let size: number;
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return notCapped();
    size = stats.size;
  } catch (error) {
    if (isMissingPathError(error)) return notCapped();
    throw error;
  }

  if (size <= opts.maxBytes) return notCapped();

  const tailLength = Math.min(size, Math.max(0, Math.floor(opts.keepBytes)));
  const tail = Buffer.allocUnsafe(tailLength);
  const offset = size - tailLength;
  const fd = openSync(path, "r");
  let bytesRead = 0;
  try {
    while (bytesRead < tailLength) {
      const count = readSync(fd, tail, bytesRead, tailLength - bytesRead, offset + bytesRead);
      if (count === 0) break;
      bytesRead += count;
    }
  } finally {
    closeSync(fd);
  }

  const readTail = tail.subarray(0, bytesRead);
  const firstNewline = readTail.indexOf(0x0a);
  const retained = firstNewline === -1 ? readTail : readTail.subarray(firstNewline + 1);
  const droppedBytes = size - retained.length;
  const marker = Buffer.from(`[log-cap] dropped ${droppedBytes} bytes\n`, "utf8");

  writeFileSync(path, Buffer.concat([marker, retained]), { flag: "w" });
  return { capped: true, droppedBytes };
}
