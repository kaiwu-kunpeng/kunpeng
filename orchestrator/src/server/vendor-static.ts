import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { shouldGzip } from "./http-compress.js";

const gzipAsync = promisify(gzip);

export interface VendorRequestMeta {
  acceptEncoding?: string | string[] | undefined;
  ifNoneMatch?: string | undefined;
}

export interface VendorResponse {
  status: 200 | 304;
  headers: Record<string, string>;
  body?: Buffer;
}

const vendorCache = new Map<string, { raw: Buffer; gz: Buffer; etag: string }>();

function etagFor(raw: Buffer): string {
  return `"${createHash("sha1").update(raw).digest("hex")}"`;
}

function matchesIfNoneMatch(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((candidate) => candidate.trim() === etag);
}

export async function vendorResponse(
  name: string,
  contentType: string,
  loadRaw: () => Promise<Buffer>,
  req: VendorRequestMeta,
): Promise<VendorResponse> {
  let cached = vendorCache.get(name);
  if (!cached) {
    const raw = await loadRaw();
    cached = { raw, gz: await gzipAsync(raw), etag: etagFor(raw) };
    vendorCache.set(name, cached);
  }

  const headers: Record<string, string> = {
    etag: cached.etag,
    "cache-control": "public, max-age=604800",
    vary: "accept-encoding",
  };

  if (matchesIfNoneMatch(req.ifNoneMatch, cached.etag)) {
    return { status: 304, headers };
  }

  headers["content-type"] = contentType;
  if (shouldGzip(req.acceptEncoding, contentType, cached.raw.byteLength)) {
    headers["content-encoding"] = "gzip";
    return { status: 200, headers, body: cached.gz };
  }

  return { status: 200, headers, body: cached.raw };
}

export function __clearVendorCache(): void {
  vendorCache.clear();
}
