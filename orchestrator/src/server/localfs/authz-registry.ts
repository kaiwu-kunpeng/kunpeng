import { readFileSync, writeFileSync } from "node:fs";

export interface LocalFsAuthz {
  conv: string;
  clientId: string;
  dirName: string;
  origin: string;
  username: string;
  ts: number;
}

export interface AuthzRegistry {
  register(entry: LocalFsAuthz): void;
  get(conv: string): LocalFsAuthz | undefined;
  matches(conv: string, clientId: string, username?: string): boolean;
  clear(conv: string): void;
}

const AUTHZ_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function isLocalFsAuthz(value: unknown): value is LocalFsAuthz {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.conv === "string"
    && typeof entry.clientId === "string"
    && typeof entry.dirName === "string"
    && typeof entry.origin === "string"
    && typeof entry.username === "string"
    && typeof entry.ts === "number";
}

export function createAuthzRegistry(maxEntries = 500, strict = false, persistPath?: string): AuthzRegistry {
  const entries = new Map<string, LocalFsAuthz>();

  const persist = (): void => {
    if (persistPath === undefined) return;
    try {
      writeFileSync(persistPath, JSON.stringify([...entries.values()]));
    } catch {
      // 持久化失败不能改变内存登记表的行为。
    }
  };

  const evictOverflow = (): boolean => {
    let evicted = false;
    while (entries.size > maxEntries) {
      const firstKey = entries.keys().next().value;
      if (typeof firstKey !== "string") return evicted;
      entries.delete(firstKey);
      evicted = true;
    }
    return evicted;
  };

  if (persistPath !== undefined) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(persistPath, "utf8"));
      if (Array.isArray(parsed) && parsed.every(isLocalFsAuthz)) {
        const now = Date.now();
        for (const entry of parsed) {
          if (now - entry.ts <= AUTHZ_MAX_AGE_MS) entries.set(entry.conv, entry);
        }
        if (evictOverflow()) persist();
      }
    } catch {
      // 文件缺失或损坏时从空登记表启动。
    }
  }

  return {
    register(entry: LocalFsAuthz): void {
      entries.set(entry.conv, entry);
      evictOverflow();
      persist();
    },
    get(conv: string): LocalFsAuthz | undefined {
      return entries.get(conv);
    },
    matches(conv: string, clientId: string, username?: string): boolean {
      const entry = entries.get(conv);
      if (!entry) return username === undefined && !strict;
      if (entry.clientId !== clientId || clientId === "") return false;
      return username === undefined || entry.username === username;
    },
    clear(conv: string): void {
      entries.delete(conv);
      persist();
    },
  };
}
