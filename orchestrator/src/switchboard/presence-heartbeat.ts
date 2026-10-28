import { join } from "node:path";
import { kunpengStateDir } from "../project/state-dir.js";
import { PresenceStore, type Heartbeat } from "./presence.js";

export type PresenceMeta = Pick<Heartbeat, "projectId" | "worktree" | "task" | "skills">;

export interface PresenceBeater {
  beat(instance: string, ts: number, meta?: PresenceMeta): Promise<void>;
}

export const DEFAULT_PRESENCE_HEARTBEAT_MS = 30_000;

export function defaultPresenceBeater(stateDir: string = kunpengStateDir()): PresenceBeater {
  return new PresenceStore(join(stateDir, "presence"));
}

export function startPresenceHeartbeat({ presence, instance, meta, intervalMs, now = Date.now }: {
  presence: PresenceBeater;
  instance: string;
  meta?: PresenceMeta;
  intervalMs?: number;
  now?: () => number;
}): { stop(): Promise<void> } {
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  const tick = (): void => {
    if (stopped || inFlight) return;
    // Keep writes single-flight so stopping drains every write, including a slow one.
    inFlight = (async () => { await presence.beat(instance, now(), meta); })()
      .catch(() => undefined)
      .finally(() => { inFlight = undefined; });
  };
  tick();
  const timer = setInterval(tick, intervalMs ?? DEFAULT_PRESENCE_HEARTBEAT_MS);
  timer.unref?.();
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}
