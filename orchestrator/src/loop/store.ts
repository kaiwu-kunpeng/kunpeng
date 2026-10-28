import * as fs from "node:fs/promises";
import { join } from "node:path";
import { LoopDefSchema, WaveSchema, type Lever, type LoopDef, type Wave } from "./types.js";

type FileSystem = Pick<typeof fs, "access" | "mkdir" | "readFile" | "readdir" | "rename" | "unlink" | "writeFile">;

export class LoopStore {
  constructor(private dir: string, private io: FileSystem = fs) {}

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await this.io.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private tempPath(path: string): string {
    const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    return `${path}.${suffix}.tmp`;
  }

  private async writeAtomic(path: string, value: LoopDef): Promise<void> {
    await this.io.mkdir(this.dir, { recursive: true });
    const tmp = this.tempPath(path);
    try {
      await this.io.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await this.io.rename(tmp, path);
    } catch (error) {
      await this.io.unlink(tmp).catch(() => undefined);
      throw error;
    }
  }

  private async readPath(path: string): Promise<LoopDef | null> {
    try {
      const raw = JSON.parse(await this.io.readFile(path, "utf8"));
      const parsed = LoopDefSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async create(def: LoopDef): Promise<void> {
    const parsed = LoopDefSchema.parse(def);
    const path = this.path(parsed.id);
    await this.io.mkdir(this.dir, { recursive: true });
    if (await this.exists(path)) {
      throw new Error(`loop already exists: ${parsed.id}`);
    }
    await this.writeAtomic(path, parsed);
  }

  async read(id: string): Promise<LoopDef | null> {
    return this.readPath(this.path(id));
  }

  async list(): Promise<LoopDef[]> {
    let files: string[];
    try {
      files = await this.io.readdir(this.dir);
    } catch {
      return [];
    }

    const loops = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .sort()
        .map((file) => this.readPath(join(this.dir, file))),
    );
    return loops.filter((loop): loop is LoopDef => loop !== null);
  }

  async appendWave(id: string, wave: Omit<Wave, "seq">): Promise<Wave> {
    const loop = await this.read(id);
    if (!loop) throw new Error(`loop not found: ${id}`);

    const seq = loop.waves.reduce((max, item) => Math.max(max, item.seq), 0) + 1;
    const fullWave = WaveSchema.parse({ ...wave, seq });
    const updated: LoopDef = {
      ...loop,
      metric: { ...loop.metric, current: fullWave.metricAfter },
      waves: [...loop.waves, fullWave],
      updatedAt: nextTimestamp(loop.updatedAt),
    };
    const parsed = LoopDefSchema.parse(updated);
    await this.writeAtomic(this.path(id), parsed);
    return fullWave;
  }

  async setNext(id: string, next: NonNullable<LoopDef["nextLever"]>): Promise<void> {
    const loop = await this.read(id);
    if (!loop) throw new Error(`loop not found: ${id}`);

    const parsed = LoopDefSchema.parse({ ...loop, nextLever: next });
    await this.writeAtomic(this.path(id), parsed);
  }

  async setLeverStatus(id: string, leverId: string, status: Lever["status"]): Promise<void> {
    const loop = await this.read(id);
    if (!loop) throw new Error(`loop not found: ${id}`);
    if (!loop.levers.some((lever) => lever.id === leverId)) {
      throw new Error(`lever not found: ${leverId}`);
    }

    const parsed = LoopDefSchema.parse({
      ...loop,
      levers: loop.levers.map((lever) => lever.id === leverId ? { ...lever, status } : lever),
    });
    await this.writeAtomic(this.path(id), parsed);
  }
}

function nextTimestamp(previous: number): number {
  const now = Date.now();
  return now > previous ? now : previous + 1;
}
