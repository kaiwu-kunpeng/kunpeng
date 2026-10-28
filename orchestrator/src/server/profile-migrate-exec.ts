import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { planMigration } from "../project/profile-migrate.js";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function legacyLoopIds(stateDir: string): Promise<string[]> {
  const dir = join(stateDir, "state");
  try {
    const names = await readdir(dir);
    const ids: string[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(await readFile(join(dir, name), "utf8")) as { flowId?: unknown };
        if (typeof parsed.flowId === "string") ids.push(parsed.flowId);
      } catch {
        // 脏状态文件不阻断布局迁移；后续验证会暴露具体坏文件。
      }
    }
    return ids;
  } catch {
    return [];
  }
}

export async function runMigration(stateDir: string): Promise<{ migrated: boolean; flaggedLoops: string[] }> {
  const loops = await legacyLoopIds(stateDir);
  const plan = planMigration({
    stateDir,
    hasProfilesDir: await exists(join(stateDir, "profiles")),
    hasLegacyProjects: await exists(join(stateDir, "projects.json")),
    legacyLoopIds: loops,
  });
  if (!plan.needed) return { migrated: false, flaggedLoops: [] };

  const lockDir = join(stateDir, ".migration.lock");
  await mkdir(lockDir, { recursive: false });
  const tmpDir = join(stateDir, ".migrate.tmp");
  try {
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });
    for (const move of plan.moves) {
      if (!(await exists(move.from))) continue;
      const tmpTarget = join(tmpDir, basename(move.to));
      await cp(move.from, tmpTarget, { recursive: true });
      await mkdir(dirname(move.to), { recursive: true });
      await rename(tmpTarget, move.to);
    }
    await writeFile(join(stateDir, ".migration-version"), "profile-v1\n", "utf8");
    await rm(tmpDir, { recursive: true, force: true });
    return { migrated: true, flaggedLoops: plan.loopsToFlag };
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}
