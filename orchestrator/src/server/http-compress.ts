import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const gzipAsync = promisify(gzip);

const COMPRESSIBLE_TYPES = new Set([
  "text/html",
  "text/css",
  "text/plain",
  "application/javascript",
  "text/javascript",
  "application/json",
  "image/svg+xml",
]);

function baseContentType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function acceptsGzip(acceptEncoding: string | string[] | undefined): boolean {
  if (!acceptEncoding) return false;
  const values = Array.isArray(acceptEncoding) ? acceptEncoding : [acceptEncoding];
  return values.some((value) => value.split(",").some((part) => {
    const [token, ...params] = part.trim().split(";").map((segment) => segment.trim().toLowerCase());
    if (token !== "gzip") return false;
    const q = params.find((param) => param.startsWith("q="));
    return q ? Number(q.slice(2)) > 0 : true;
  }));
}

export function shouldGzip(
  acceptEncoding: string | string[] | undefined,
  contentType: string,
  byteLength: number,
): boolean {
  const type = baseContentType(contentType);
  if (type === "text/event-stream") return false;
  if (!acceptsGzip(acceptEncoding)) return false;
  if (byteLength < 1024) return false;
  return COMPRESSIBLE_TYPES.has(type);
}

export async function sendMaybeGzip(
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
  contentType: string,
): Promise<void> {
  res.setHeader("content-type", contentType);
  const rawBuffer = Buffer.from(body, "utf8");
  if (shouldGzip(req.headers["accept-encoding"], contentType, rawBuffer.byteLength)) {
    const gzippedBuffer = await gzipAsync(rawBuffer);
    res.setHeader("content-encoding", "gzip");
    res.setHeader("vary", "accept-encoding");
    res.end(gzippedBuffer);
    return;
  }
  res.end(rawBuffer);
}
