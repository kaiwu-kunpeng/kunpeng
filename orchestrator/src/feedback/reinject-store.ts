import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReinjectTask } from "./finding-to-task.js";

export interface ReinjectEntry extends ReinjectTask {
  status: "pending" | "consumed" | "deferred";
  createdAt: number;
  consumedAt?: number;
  attempts?: number;
  lastFailedAt?: number;
}

export class ReinjectStore {
  constructor(private dir: string) {}

  private path(fingerprint: string): string {
    return join(this.dir, `${fingerprint}.json`);
  }

  async enqueue(tasks: ReinjectTask[], now: number): Promise<{ added: string[]; skipped: string[] }> {
    await mkdir(this.dir, { recursive: true });
    const added: string[] = [];
    const skipped: string[] = [];
    const existing = new Set(await this.listFingerprints());

    for (const task of tasks) {
      if (existing.has(task.fingerprint)) {
        skipped.push(task.fingerprint);
        continue;
      }

      const entry: ReinjectEntry = { ...task, status: "pending", createdAt: now };
      await writeFile(this.path(task.fingerprint), JSON.stringify(entry, null, 2));
      existing.add(task.fingerprint);
      added.push(task.fingerprint);
    }

    return { added, skipped };
  }

  private async listFingerprints(): Promise<string[]> {
    const files = (await readdir(this.dir).catch(() => [] as string[])).filter((file) => file.endsWith(".json"));
    return files.map((file) => file.replace(/\.json$/, ""));
  }

  async list(opts?: { status?: "pending" | "consumed" | "deferred" }): Promise<ReinjectEntry[]> {
    const fingerprints = await this.listFingerprints();
    const entries: ReinjectEntry[] = [];

    for (const fingerprint of fingerprints) {
      try {
        const entry = JSON.parse(await readFile(this.path(fingerprint), "utf8")) as ReinjectEntry;
        if (opts?.status && entry.status !== opts.status) continue;
        entries.push(entry);
      } catch {
        // Malformed or unreadable backlog entries should not block the queue.
      }
    }

    return entries.sort((left, right) => left.createdAt - right.createdAt);
  }

  async pending(): Promise<ReinjectEntry[]> {
    return this.list({ status: "pending" });
  }

  async markConsumed(fingerprint: string, now: number): Promise<void> {
    try {
      const entry = JSON.parse(await readFile(this.path(fingerprint), "utf8")) as ReinjectEntry;
      entry.status = "consumed";
      entry.consumedAt = now;
      await writeFile(this.path(fingerprint), JSON.stringify(entry, null, 2));
    } catch {
      // Missing or unreadable files are ignored by contract.
    }
  }

  async recordFailure(
    fingerprint: string,
    now: number,
    maxAttempts = 2,
  ): Promise<{ attempts: number; deferred: boolean }> {
    try {
      const entry = JSON.parse(await readFile(this.path(fingerprint), "utf8")) as ReinjectEntry;
      const attempts = (entry.attempts ?? 0) + 1;
      entry.attempts = attempts;
      entry.lastFailedAt = now;
      if (attempts >= maxAttempts) entry.status = "deferred";
      await writeFile(this.path(fingerprint), JSON.stringify(entry, null, 2));
      return { attempts, deferred: entry.status === "deferred" };
    } catch {
      return { attempts: 0, deferred: false };
    }
  }
}
