import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface OutboxPayload { urls: string[]; host?: string; keyLocation?: string; }
export interface OutboxEntry {
  id: string;
  channel: string;
  at: string;
  payload: OutboxPayload;
  status: "pending" | "flushed";
  flushedAt?: string;
}

function outboxDir(repoRoot: string): string {
  return join(repoRoot, ".kunpeng", "outbox");
}

function assertChannel(channel: string): void {
  if (!/^[a-z0-9._-]+$/i.test(channel)) {
    throw new Error(`invalid outbox channel: ${channel}`);
  }
}

function channelFile(repoRoot: string, channel: string): string {
  assertChannel(channel);
  return join(outboxDir(repoRoot), `${channel}.json`);
}

function readEntries(repoRoot: string, channel: string): OutboxEntry[] {
  const file = channelFile(repoRoot, channel);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`invalid outbox file: ${file}: ${reason}`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn(`invalid outbox file: ${file}: expected an array`);
    return [];
  }
  return parsed as OutboxEntry[];
}

function writeEntries(repoRoot: string, channel: string, entries: OutboxEntry[]): void {
  const dir = outboxDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const file = channelFile(repoRoot, channel);
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
    renameSync(tmp, file);
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // best-effort cleanup; original write error is the failure signal
    }
    throw error;
  }
}

function nextId(): string {
  return `obx-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
}

export function enqueueOutbox(repoRoot: string, channel: string, payload: OutboxPayload): OutboxEntry {
  const entries = readEntries(repoRoot, channel);
  const entry: OutboxEntry = {
    id: nextId(),
    channel,
    at: new Date().toISOString(),
    payload,
    status: "pending",
  };
  writeEntries(repoRoot, channel, [...entries, entry]);
  return entry;
}

export function listOutbox(
  repoRoot: string,
  channel?: string,
  opts: { includeFlushed?: boolean } = {},
): OutboxEntry[] {
  const entries = channel
    ? readEntries(repoRoot, channel)
    : listAllEntries(repoRoot);
  return opts.includeFlushed ? entries : entries.filter((entry) => entry.status === "pending");
}

function listAllEntries(repoRoot: string): OutboxEntry[] {
  const dir = outboxDir(repoRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => readEntries(repoRoot, name.slice(0, -".json".length)));
}

export async function flushOutbox(
  repoRoot: string,
  channel: string,
  sender: (payload: OutboxPayload) => Promise<boolean>,
): Promise<{ flushed: number; failed: number }> {
  const entries = readEntries(repoRoot, channel);
  if (entries.length === 0) return { flushed: 0, failed: 0 };
  let flushed = 0;
  let failed = 0;
  const nextEntries: OutboxEntry[] = [];

  for (const entry of entries) {
    if (entry.status !== "pending") {
      nextEntries.push(entry);
      continue;
    }

    let ok: boolean;
    try {
      ok = await sender(entry.payload);
    } catch {
      ok = false;
    }

    if (ok) {
      flushed += 1;
      nextEntries.push({ ...entry, status: "flushed", flushedAt: new Date().toISOString() });
    } else {
      failed += 1;
      nextEntries.push(entry);
    }
  }

  writeEntries(repoRoot, channel, nextEntries);
  return { flushed, failed };
}
