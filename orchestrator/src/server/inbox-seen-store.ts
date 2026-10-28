import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function isItemKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const separator = value.indexOf(":");
  return separator > 0 && separator < value.length - 1;
}

export class InboxSeenStore {
  readonly #path: string;
  readonly #max: number;

  constructor(path: string, max = 2000) {
    this.#path = path;
    this.#max = Math.max(0, Math.floor(max));
  }

  async #readEntries(): Promise<Array<[string, number]>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#path, "utf8"));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
      return Object.entries(parsed)
        .filter((entry): entry is [string, number] => isItemKey(entry[0]) && typeof entry[1] === "number" && Number.isFinite(entry[1]));
    } catch {
      return [];
    }
  }

  async getSeen(): Promise<Set<string>> {
    return new Set((await this.#readEntries()).map(([key]) => key));
  }

  async markSeen(keys: readonly string[]): Promise<void> {
    const itemKeys = keys.filter(isItemKey);
    if (itemKeys.length === 0) return;

    let tmpPath: string | undefined;
    try {
      const entries = new Map(await this.#readEntries());
      const now = Date.now();
      for (const key of itemKeys) {
        // Reinsert an existing key so trimming retains the most recently observed items.
        entries.delete(key);
        entries.set(key, now);
      }
      while (entries.size > this.#max) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }

      await mkdir(dirname(this.#path), { recursive: true });
      tmpPath = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tmpPath, `${JSON.stringify(Object.fromEntries(entries))}\n`, "utf8");
      await rename(tmpPath, this.#path);
    } catch {
      if (tmpPath !== undefined) await unlink(tmpPath).catch(() => undefined);
    }
  }
}
