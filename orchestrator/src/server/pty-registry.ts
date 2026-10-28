import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface PtyRegistryEntry {
  id: string;
  workspaceId: string;
  cwd: string;
  createdAt: number;
}

type PtyRegistry = Record<string, PtyRegistryEntry>;

function tempPath(path: string): string {
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  return `${path}.${suffix}.tmp`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPtyRegistryEntry(value: unknown): value is PtyRegistryEntry {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.cwd === "string" &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt)
  );
}

function parsePtyRegistry(value: unknown): PtyRegistry {
  if (!isPlainRecord(value)) {
    return {};
  }

  const registry: PtyRegistry = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isPtyRegistryEntry(entry) || entry.id !== id) {
      return {};
    }
    registry[id] = entry;
  }
  return registry;
}

async function writePtyRegistry(path: string, registry: PtyRegistry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = tempPath(path);
  try {
    await writeFile(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

export async function readPtyRegistry(path: string): Promise<PtyRegistry> {
  try {
    return parsePtyRegistry(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch {
    return {};
  }
}

export async function upsertPtyEntry(path: string, entry: PtyRegistryEntry): Promise<void> {
  const registry = await readPtyRegistry(path);
  registry[entry.id] = entry;
  await writePtyRegistry(path, registry);
}

export async function removePtyEntry(path: string, id: string): Promise<void> {
  const registry = await readPtyRegistry(path);
  if (!(id in registry)) {
    return;
  }
  delete registry[id];
  await writePtyRegistry(path, registry);
}
