import { isRecord } from "../util/is-record.js";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export interface UpdateManifest {
  version: string;
  url?: string;
  notes?: string;
  sha256?: string;
}

function numericSegment(segment: string): bigint {
  return /^\d+$/.test(segment) ? BigInt(segment) : 0n;
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const aSegments = a.split(".");
  const bSegments = b.split(".");
  const segmentCount = Math.max(aSegments.length, bSegments.length);

  for (let index = 0; index < segmentCount; index += 1) {
    const aSegment = numericSegment(aSegments[index] ?? "0");
    const bSegment = numericSegment(bSegments[index] ?? "0");
    if (aSegment < bSegment) return -1;
    if (aSegment > bSegment) return 1;
  }

  return 0;
}

export async function checkRemoteManifest(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateManifest | null> {
  try {
    const response = fetchImpl === fetch
      ? await fetchImpl(url, { signal: AbortSignal.timeout(10_000) })
      : await fetchImpl(url);
    if (!response.ok) return null;

    const data: unknown = await response.json();
    if (!isRecord(data) || typeof data.version !== "string") return null;

    return {
      version: data.version,
      ...(typeof data.url === "string" ? { url: data.url } : {}),
      ...(typeof data.notes === "string" ? { notes: data.notes } : {}),
      ...(typeof data.sha256 === "string" && data.sha256.length === 64 && /^[0-9a-f]{64}$/i.test(data.sha256)
        ? { sha256: data.sha256.toLowerCase() }
        : {}),
    };
  } catch {
    return null;
  }
}

function downloadFilename(url: string): string {
  try {
    return basename(new URL(url).pathname) || "update.bin";
  } catch {
    return "update.bin";
  }
}

export async function downloadUpdate(
  manifest: UpdateManifest,
  destRoot: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/.test(manifest.version) || manifest.version.includes("..")) {
    throw new Error(`无效的版本号：${manifest.version}`);
  }
  if (!manifest.url) throw new Error("update manifest url is required");
  const sha256 = manifest.sha256;
  if (typeof sha256 !== "string" || sha256.length !== 64 || !/^[0-9a-f]{64}$/i.test(sha256)) {
    throw new Error("update manifest sha256 must be 64 hexadecimal characters");
  }
  const expectedSha256 = sha256.toLowerCase();

  const versionDirectory = resolve(destRoot, manifest.version);
  await mkdir(versionDirectory, { recursive: true });

  const response = fetchImpl === fetch
    ? await fetchImpl(manifest.url, { signal: AbortSignal.timeout(60_000) })
    : await fetchImpl(manifest.url);
  if (!response.ok) {
    throw new Error(`update download failed with status ${response.status}`);
  }

  const destination = join(versionDirectory, downloadFilename(manifest.url));
  const body = new Uint8Array(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(body).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(`update sha256 mismatch: expected ${expectedSha256}, actual ${actualSha256}`);
  }
  await writeFile(destination, body);
  return destination;
}
