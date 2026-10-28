import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { CaptureStore } from "../knowledge/capture-store.js";
import { listSkills } from "../skills/registry.js";
import { libraryEntryId, type LibraryEntry, type LibraryEntryStatus, type LibraryEntryType } from "./entry.js";
import { applyMeta, readMeta } from "./meta.js";

export interface LibrarySearchFilter {
  type?: LibraryEntryType;
  status?: LibraryEntryStatus;
  needsReview?: boolean;
  audience?: "human" | "agent";
}

export interface BuildLibraryIndexOptions {
  specsDir?: string;
  docsDir?: string;
  skillsRoot?: string;
  stateDir: string;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function sourceFiles(root: string, extensions: Set<string>, skipLogs: boolean): Promise<string[]> {
  const absoluteRoot = resolve(root);
  const files: string[] = [];
  async function visit(dir: string): Promise<void> {
    let children;
    try {
      children = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    for (const child of children) {
      if (child.isDirectory()) {
        if (skipLogs && child.name === "logs") continue;
        await visit(join(dir, child.name));
      } else if (child.isFile() && extensions.has(extname(child.name).toLowerCase())) {
        files.push(join(dir, child.name));
      }
    }
  }
  await visit(absoluteRoot);
  return files.sort();
}

function markdownTitle(content: string, path: string): string {
  return content.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() || basename(path);
}

function htmlTitle(content: string, path: string): string {
  return content.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || basename(path);
}

function entry(input: Omit<LibraryEntry, "id">): LibraryEntry {
  return { ...input, id: libraryEntryId(input.type, input.sourcePath) };
}

export async function scanSpecs(dir: string): Promise<LibraryEntry[]> {
  const root = resolve(dir);
  const files = await sourceFiles(root, new Set([".md"]), true);
  return Promise.all(files.map(async (sourcePath) => {
    const [content, info] = await Promise.all([readFile(sourcePath, "utf8"), stat(sourcePath)]);
    return entry({
      type: "spec",
      title: markdownTitle(content, sourcePath),
      status: relative(root, sourcePath).split(sep).includes("archive") ? "archived" : "active",
      tags: [],
      sourcePath,
      updatedAt: info.mtimeMs,
    });
  }));
}

async function scanDocs(dir: string): Promise<LibraryEntry[]> {
  const files = await sourceFiles(dir, new Set([".md", ".html"]), false);
  return Promise.all(files.map(async (sourcePath) => {
    const [content, info] = await Promise.all([readFile(sourcePath, "utf8"), stat(sourcePath)]);
    return entry({
      type: "doc",
      title: extname(sourcePath).toLowerCase() === ".html" ? htmlTitle(content, sourcePath) : markdownTitle(content, sourcePath),
      status: "active",
      tags: [],
      sourcePath,
      updatedAt: info.mtimeMs,
    });
  }));
}

async function scanSkills(root: string): Promise<LibraryEntry[]> {
  const absoluteRoot = resolve(root);
  let skills;
  try {
    skills = listSkills(absoluteRoot);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return Promise.all(skills.map(async (skill) => {
    const sourcePath = resolve(skill.dir);
    const info = await stat(sourcePath);
    return entry({
      type: "skill",
      title: skill.name,
      status: "active",
      tags: skill.tags ?? [],
      sourcePath,
      updatedAt: info.mtimeMs,
    });
  }));
}

export async function captureDirsUnder(stateDir: string): Promise<string[]> {
  const capturesDir = join(resolve(stateDir), "captures");
  const sharedKnowledgeDir = join(resolve(stateDir), "shared", "knowledge");
  const dirs: string[] = [];

  try {
    const info = await stat(capturesDir);
    if (info.isDirectory()) {
      dirs.push(capturesDir);
      const children = await readdir(capturesDir, { withFileTypes: true });
      dirs.push(...children
        .filter((child) => child.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((child) => join(capturesDir, child.name)));
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  try {
    const info = await stat(sharedKnowledgeDir);
    if (info.isDirectory()) dirs.push(sharedKnowledgeDir);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  return dirs;
}

async function scanCaptures(stateDir: string): Promise<LibraryEntry[]> {
  const batches = await Promise.all(
    (await captureDirsUnder(stateDir)).map((dir) => new CaptureStore(dir).listCaptures()),
  );
  const seen = new Set<string>();
  const captures = batches.flat().filter((capture) => {
    if (seen.has(capture.id)) return false;
    seen.add(capture.id);
    return true;
  });
  return captures.map((capture) => entry({
    type: "capture",
    title: capture.title ?? capture.summary ?? capture.id,
    ...(capture.projectId ? { project: capture.projectId } : {}),
    status: "active",
    tags: capture.tags,
    sourcePath: capture.id,
    updatedAt: capture.createdAt,
  }));
}

export async function buildLibraryIndex(options: BuildLibraryIndexOptions): Promise<{ entries: LibraryEntry[]; indexPath: string }> {
  const [specs, docs, skills, captures] = await Promise.all([
    options.specsDir ? scanSpecs(options.specsDir) : [],
    options.docsDir ? scanDocs(options.docsDir) : [],
    options.skillsRoot ? scanSkills(options.skillsRoot) : [],
    scanCaptures(options.stateDir),
  ]);
  const scanned = [...specs, ...docs, ...skills, ...captures]
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
  const entries = applyMeta(scanned, await readMeta(options.stateDir), Date.now());
  const indexPath = join(resolve(options.stateDir), "library", "index.json");
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  return { entries, indexPath };
}

export function searchLibrary(entries: LibraryEntry[], q: string, filter: LibrarySearchFilter = {}): LibraryEntry[] {
  const query = q.trim().toLowerCase();
  return entries.filter((candidate) => {
    if (filter.type !== undefined && candidate.type !== filter.type) return false;
    if (filter.status !== undefined && candidate.status !== filter.status) return false;
    if (filter.needsReview !== undefined && candidate.needsReview !== filter.needsReview) return false;
    if (filter.audience !== undefined && candidate.audience !== filter.audience) return false;
    if (query === "") return true;
    return [candidate.title, ...candidate.tags, candidate.sourcePath]
      .some((value) => value.toLowerCase().includes(query));
  });
}
