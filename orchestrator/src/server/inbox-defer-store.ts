import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function isItemKey(value: unknown): value is string {
  return typeof value === "string" && /^[a-z-]+:.+$/.test(value);
}

export class InboxDeferStore {
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

  async getDeferred(now: number): Promise<Set<string>> {
    return new Set((await this.#readEntries()).filter(([, until]) => until > now).map(([key]) => key));
  }

  async markDeferred(keys: readonly string[], untilMs: number): Promise<void> {
    const itemKeys = keys.filter(isItemKey);
    if (itemKeys.length === 0 || !Number.isFinite(untilMs)) return;

    let tmpPath: string | undefined;
    try {
      // 历史期限写入不清理比传入期限更晚的记录；正常稍后请求按当前时间清理。
      const cutoff = Math.min(Date.now(), untilMs);
      const entries = new Map((await this.#readEntries()).filter(([, until]) => until > cutoff));
      for (const key of itemKeys) {
        entries.delete(key);
        entries.set(key, untilMs);
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
