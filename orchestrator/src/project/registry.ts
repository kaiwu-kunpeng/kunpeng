import { mkdir, readFile, stat, readdir } from "node:fs/promises";
import { join, basename, normalize, sep } from "node:path";
import { writeFileAtomic } from "../util/atomic-write.js";
import { readProfileRegistry, writeProfileRegistry } from "./registry-profile.js";

export interface ProjectEntry {
  id: string;
  name: string;
  repoPath: string;
  registeredAt: number;
  ops?: {
    playbooks?: string[];
    northstar?: { key: string; label: string };
    mode?: "manual" | "cron" | "threshold";
  };
}

/** 跨项目运行时状态目录（注册表所在）。与只读的 KUNPENG_HOME（宪法源）解耦。 */
export { kunpengStateDir } from "./state-dir.js";

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "project";
}

export function isFlowWorktreePath(p: string): boolean {
  const segments = normalize(p).split(sep);
  return segments.some((segment, index) =>
    segment === ".kunpeng"
    && (segments[index + 1] === "wt" || segments[index + 1] === "worktrees")
    && index + 2 < segments.length,
  );
}

export async function assertRegistrableRepo(repoPath: string): Promise<{ ok: boolean; error?: string }> {
  const p = (repoPath ?? "").trim();
  if (!p) return { ok: false, error: "请填写仓库路径" };
  if (isFlowWorktreePath(p)) return { ok: false, error: "flow worktree 不能注册为项目" };
  if (!p.startsWith("/")) return { ok: false, error: "请用绝对路径（以 / 开头）" };
  try {
    const s = await stat(p);
    if (!s.isDirectory()) return { ok: false, error: "该路径不是目录" };
    return { ok: true };
  } catch {
    return { ok: false, error: "路径不存在" };
  }
}

function registryPath(stateDir: string): string { return join(stateDir, "projects.json"); }

function isProjectEntry(e: unknown): e is ProjectEntry {
  return typeof e === "object" && e !== null
    && typeof (e as ProjectEntry).id === "string"
    && typeof (e as ProjectEntry).name === "string"
    && typeof (e as ProjectEntry).repoPath === "string"
    && typeof (e as ProjectEntry).registeredAt === "number";
}

export async function readRegistry(stateDir: string): Promise<ProjectEntry[]> {
  try {
    const data = JSON.parse(await readFile(registryPath(stateDir), "utf8"));
    // 形状校验：只接受合法的 ProjectEntry，过滤掉缺字段/类型错的脏条目（防下游崩溃）。
    const projects = Array.isArray(data) ? data : data?.projects;
    return Array.isArray(projects) ? projects.filter(isProjectEntry) : [];
  } catch { return []; }
}

async function writeRegistry(stateDir: string, projects: ProjectEntry[]): Promise<void> {
  await writeFileAtomic(registryPath(stateDir), JSON.stringify({ projects }, null, 2));
}

export async function updateProjectOps(
  stateDir: string,
  id: string,
  ops: NonNullable<ProjectEntry["ops"]>,
): Promise<ProjectEntry | null> {
  const projects = await readRegistry(stateDir);
  const entry = projects.find((project) => project.id === id);
  if (!entry) return null;

  entry.ops = { ...entry.ops, ...ops };
  await writeFileAtomic(registryPath(stateDir), JSON.stringify(projects, null, 2));
  return entry;
}

export async function readProjectSelf(repoPath: string): Promise<{ id: string; name: string; registeredAt: number } | null> {
  try {
    const data = JSON.parse(await readFile(join(repoPath, ".kunpeng", "project.json"), "utf8"));
    if (typeof data?.id === "string" && typeof data?.name === "string" && typeof data?.registeredAt === "number") return data;
    return null;
  } catch { return null; }
}

export interface RegisterInput { repoPath: string; name?: string; stateDir: string; now: number; }

async function syncProjectToExistingProfiles(stateDir: string, entry: ProjectEntry): Promise<void> {
  const profilesDir = join(stateDir, "profiles");
  let profileDirs: string[];
  try {
    profileDirs = (await readdir(profilesDir, { withFileTypes: true }))
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
  } catch {
    return;
  }

  for (const profileId of profileDirs) {
    try {
      const projectsPath = join(profilesDir, profileId, "projects.json");
      const projects = readProfileRegistry(projectsPath).filter((project) => project.id !== entry.id);
      projects.push(entry);
      writeProfileRegistry(projectsPath, projects);
    } catch {
      continue;
    }
  }
}

export async function registerProject(input: RegisterInput): Promise<ProjectEntry> {
  if (isFlowWorktreePath(input.repoPath)) {
    throw new Error(`flow worktree 不是项目:${input.repoPath}——flow 归属其父项目,不入项目表`);
  }
  const name = input.name?.trim() || basename(input.repoPath);
  // id 来自 repo 目录名（英文、稳定）——不从 name slug 化，否则中文 name 会塌成空、互相撞 id。
  const id = slugify(basename(input.repoPath));
  const entry: ProjectEntry = { id, name, repoPath: input.repoPath, registeredAt: input.now };
  // 中央表：幂等——同 id 先剔除再追加（更新语义）。
  const existing = (await readRegistry(input.stateDir)).filter((p) => p.id !== id);
  existing.push(entry);
  await writeRegistry(input.stateDir, existing);
  // repo 自描：让 repo 内子 agent 无需中央表也能自证身份。
  const selfDir = join(input.repoPath, ".kunpeng");
  await mkdir(selfDir, { recursive: true });
  await writeFileAtomic(join(selfDir, "project.json"), JSON.stringify({ id, name, registeredAt: input.now }, null, 2));
  await syncProjectToExistingProfiles(input.stateDir, entry);
  return entry;
}
