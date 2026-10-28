export interface ParsedHit {
  ua: string;
  path: string;
  status: number | null;
  host: string | null;
  ts: number | null;
}

export function parseDrainPayload(body: string): ParsedHit[] {
  const hits: ParsedHit[] = [];

  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) {
      appendHits(parsed, hits);
      return hits;
    }
  } catch {
    // Fall through to NDJSON parsing.
  }

  try {
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed) as unknown;
        appendHit(parsed, hits);
      } catch {
        // A malformed drain line should not discard the valid lines.
      }
    }
  } catch {
    return hits;
  }

  return hits;
}

function appendHits(items: unknown[], hits: ParsedHit[]): void {
  for (const item of items) {
    appendHit(item, hits);
  }
}

function appendHit(item: unknown, hits: ParsedHit[]): void {
  try {
    const record = asRecord(item);
    const proxy = asRecord(record?.proxy);
    if (!proxy) {
      return;
    }

    const ua = readUserAgent(proxy.userAgent);
    if (!ua) {
      return;
    }

    hits.push({
      ua,
      path: readString(proxy.path) ?? "",
      status: readNumber(proxy.statusCode),
      host: readString(proxy.host),
      ts: readNumber(proxy.timestamp),
    });
  } catch {
    return;
  }
}

function readUserAgent(value: unknown): string | null {
  const ua = Array.isArray(value) ? value[0] : value;
  const text = readString(ua);
  return text && text.length > 0 ? text : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
