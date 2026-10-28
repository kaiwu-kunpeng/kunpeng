import type { Heartbeat } from "../switchboard/presence.js";
import { TaskBoard, type Task } from "./store.js";

type PresenceReader = {
  list(): Promise<Pick<Heartbeat, "instance" | "ts">[]>;
};

export function deadOwners(
  heartbeats: Pick<Heartbeat, "instance" | "ts">[],
  owners: string[],
  now: number,
  staleMs = 600_000,
): string[] {
  const latestByOwner = new Map<string, number>();
  const referencedOwners = new Set(owners);
  for (const heartbeat of heartbeats) {
    if (!referencedOwners.has(heartbeat.instance)) continue;
    const latest = latestByOwner.get(heartbeat.instance);
    if (latest === undefined || heartbeat.ts > latest) {
      latestByOwner.set(heartbeat.instance, heartbeat.ts);
    }
  }

  const threshold = now - staleMs;
  return [...referencedOwners].filter((owner) => {
    const latest = latestByOwner.get(owner);
    return latest === undefined || latest < threshold;
  });
}

export function tasksToReclaim(
  tasks: Task[],
  heartbeats: Pick<Heartbeat, "instance" | "ts">[],
  now: number,
  staleMs = 600_000,
): string[] {
  const active = tasks.filter(
    (task): task is Task & { owner: string } => task.status === "in_progress" && typeof task.owner === "string",
  );
  const dead = new Set(deadOwners(heartbeats, active.map((task) => task.owner), now, staleMs));
  return active.filter((task) => dead.has(task.owner)).map((task) => task.id);
}

export async function reapDeadTasks(
  board: TaskBoard,
  presence: PresenceReader,
  now: number,
  staleMs = 600_000,
): Promise<string[]> {
  const heartbeats = await presence.list();
  const taskIds = tasksToReclaim(await board.list(), heartbeats, now, staleMs);
  const released: string[] = [];
  for (const id of taskIds) {
    await board.reclaim(id);
    released.push(id);
  }
  return released;
}
