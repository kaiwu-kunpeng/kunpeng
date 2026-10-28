import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Heartbeat {
  instance: string;
  ts: number;
  projectId?: string;
  worktree?: string;
  task?: string;
  skills?: string[];
}

export function isOnline(lastTs: number, now: number, windowMs = 60_000): boolean {
  return now - lastTs <= windowMs;
}

export class PresenceStore {
  constructor(private dir: string) {}

  private path(instance: string): string {
    return join(this.dir, `${encodeURIComponent(instance)}.json`);
  }

  async beat(instance: string, ts: number, meta: Pick<Heartbeat, "projectId" | "worktree" | "task" | "skills"> = {}): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(instance), JSON.stringify({ instance, ts, ...meta } satisfies Heartbeat, null, 2));
  }

  async list(): Promise<Heartbeat[]> {
    const files = (await readdir(this.dir).catch(() => [] as string[])).filter((file) => file.endsWith(".json"));
    const heartbeats: Heartbeat[] = [];

    for (const file of files) {
      try {
        const heartbeat = JSON.parse(await readFile(join(this.dir, file), "utf8")) as unknown;
        if (isHeartbeat(heartbeat)) {
          heartbeats.push(heartbeat);
        }
      } catch {
        // A malformed heartbeat file must not make presence unreadable.
      }
    }

    return heartbeats.sort((a, b) => b.ts - a.ts);
  }

  async online(now: number, windowMs = 60_000): Promise<string[]> {
    return (await this.list()).filter((heartbeat) => isOnline(heartbeat.ts, now, windowMs)).map((heartbeat) => heartbeat.instance);
  }
}

function isHeartbeat(value: unknown): value is Heartbeat {
  return (
    typeof value === "object" &&
    value !== null &&
    "instance" in value &&
    "ts" in value &&
    typeof value.instance === "string" &&
    typeof value.ts === "number"
  );
}
