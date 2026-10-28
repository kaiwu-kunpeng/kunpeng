import { createHash } from "node:crypto";

export const SCRAPED_NS = "5e3c9a2b-1234-5678-90ab-cdef00000000";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function namespaceBytes(namespace: string): Buffer {
  if (!UUID_RE.test(namespace)) {
    throw new Error(`uuidv5: invalid namespace UUID: ${namespace}`);
  }
  return Buffer.from(namespace.replace(/-/g, ""), "hex");
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function uuidv5(name: string, namespace: string): string {
  const ns = namespaceBytes(namespace);
  const hash = createHash("sha1").update(ns).update(name, "utf8").digest();
  const bytes = Buffer.from(hash.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return formatUuid(bytes);
}
