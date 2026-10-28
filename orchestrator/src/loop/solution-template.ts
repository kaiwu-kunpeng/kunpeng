import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { kunpengStateDir } from "../project/state-dir.js";

export interface SolutionTemplate {
  id: string;
  name: string;
  description?: string;
  playbookFiles: string[];
  loopFiles?: string[];
  configFiles?: string[];
  createdAt: string;
}

type FrontmatterBlock = {
  contentStart: number;
  contentEnd: number;
  raw: string;
};

export function solutionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(kunpengStateDir(env), "solutions");
}

export function saveTemplateFromProject(
  root: string,
  repoRoot: string,
  opts: { id: string; name: string; description?: string; playbookIds: string[]; configPaths?: string[] },
): SolutionTemplate {
  const sourceDir = join(repoRoot, ".kunpeng", "playbooks");
  const files = listMarkdownFiles(sourceDir);
  const byId = new Map<string, { file: string; content: string }>();

  for (const file of files) {
    const content = readFileSync(join(sourceDir, file), "utf8");
    const id = readFrontmatterId(content);
    if (id) byId.set(id, { file, content });
  }

  const playbookDir = join(root, opts.id, "playbooks");
  const loopDir = join(root, opts.id, "loops");
  mkdirSync(playbookDir, { recursive: true });

  const playbookFiles: string[] = [];
  const loopFiles = new Set<string>();
  for (const playbookId of opts.playbookIds) {
    const found = byId.get(playbookId);
    if (!found) throw new Error(`找不到 playbookId：${playbookId}`);

    const targetFile = basename(found.file);
    writeFileSync(join(playbookDir, targetFile), removeProjectIdFromFrontmatter(found.content), "utf8");
    playbookFiles.push(targetFile);

    const loopId = readFrontmatterValue(found.content, "loopId");
    if (!loopId) continue;

    const loopFile = `${loopId}.json`;
    const cleaned = readTemplateLoopForSave(join(repoRoot, ".kunpeng", "loops", loopFile));
    if (!cleaned) continue;

    if (!loopFiles.has(loopFile)) {
      atomicWriteJson(join(loopDir, loopFile), cleaned);
      loopFiles.add(loopFile);
    }
  }

  const configFiles: string[] = [];
  for (const configPath of opts.configPaths ?? []) {
    const safePath = validateRepoRelativePath(configPath);
    const source = join(repoRoot, safePath);
    if (!existsSync(source)) throw new Error(`找不到配置文件：${safePath}`);

    const target = join(root, opts.id, "config", safePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(source, "utf8"), "utf8");
    configFiles.push(safePath);
  }

  const template: SolutionTemplate = {
    id: opts.id,
    name: opts.name,
    ...(opts.description ? { description: opts.description } : {}),
    playbookFiles,
    ...(loopFiles.size ? { loopFiles: [...loopFiles] } : {}),
    ...(configFiles.length ? { configFiles } : {}),
    createdAt: new Date().toISOString(),
  };
  atomicWriteJson(join(root, opts.id, "template.json"), template);
  return template;
}

export function listTemplates(root: string): SolutionTemplate[] {
  if (!existsSync(root)) return [];

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readTemplate(join(root, entry.name, "template.json")))
    .filter((template): template is SolutionTemplate => template !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function instantiateTemplate(
  root: string,
  id: string,
  repoRoot: string,
  projectId: string,
  opts: { projectName?: string } = {},
): {
  written: string[];
  skipped: string[];
  loopsWritten: string[];
  loopsSkipped: string[];
  configsWritten: string[];
  configsSkipped: string[];
} {
  const templateDir = join(root, id);
  const templatePath = join(templateDir, "template.json");
  if (!existsSync(templateDir) || !existsSync(templatePath)) throw new Error(`方案模板不存在：${id}`);
  const template = readTemplate(templatePath);
  if (!template) throw new Error(`方案模板不可读：${id}`);
  const vars = { projectId, projectName: opts.projectName };

  const playbookDir = join(templateDir, "playbooks");
  const targetDir = join(repoRoot, ".kunpeng", "playbooks");
  mkdirSync(targetDir, { recursive: true });

  const files = listMarkdownFiles(playbookDir);
  const written: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const target = join(targetDir, file);
    if (existsSync(target)) {
      skipped.push(file);
      continue;
    }

    const content = readFileSync(join(playbookDir, file), "utf8");
    writeFileSync(target, upsertProjectIdInFrontmatter(substituteProjectVars(content, vars), projectId), "utf8");
    written.push(file);
  }

  const templateLoopDir = join(templateDir, "loops");
  const targetLoopDir = join(repoRoot, ".kunpeng", "loops");
  const loopsWritten: string[] = [];
  const loopsSkipped: string[] = [];
  for (const file of template.loopFiles ?? []) {
    const target = join(targetLoopDir, file);
    if (existsSync(target)) {
      loopsSkipped.push(file);
      continue;
    }

    const loop = JSON.parse(readFileSync(join(templateLoopDir, file), "utf8")) as Record<string, unknown>;
    const now = Date.now();
    atomicWriteJson(target, { ...loop, projectId, waves: [], createdAt: now, updatedAt: now });
    loopsWritten.push(file);
  }

  const templateConfigDir = join(templateDir, "config");
  const configsWritten: string[] = [];
  const configsSkipped: string[] = [];
  for (const file of template.configFiles ?? []) {
    const safePath = validateRepoRelativePath(file);
    const target = join(repoRoot, safePath);
    if (existsSync(target)) {
      configsSkipped.push(safePath);
      continue;
    }

    const content = readFileSync(join(templateConfigDir, safePath), "utf8");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, substituteProjectVars(content, vars), "utf8");
    configsWritten.push(safePath);
  }

  return { written, skipped, loopsWritten, loopsSkipped, configsWritten, configsSkipped };
}

export function selectAutoRunLoops(repoRoot: string, loopsWritten: string[]): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const file of loopsWritten) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(repoRoot, ".kunpeng", "loops", file), "utf8")) as unknown;
    } catch {
      continue;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
    const loop = parsed as Record<string, unknown>;
    const id = loop.id;
    if (loop.autonomous !== true || typeof id !== "string" || id.trim() === "") continue;
    if (seen.has(id)) continue;
    seen.add(id);
    selected.push(id);
  }

  return selected;
}

export function substituteProjectVars(content: string, vars: { projectId: string; projectName?: string }): string {
  const projectName = vars.projectName ?? vars.projectId;
  return content.replace(/\{\{project\.id\}\}/g, vars.projectId).replace(/\{\{project\.name\}\}/g, projectName);
}

function listMarkdownFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temp, path);
}

function readTemplate(path: string): SolutionTemplate | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isSolutionTemplate(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isSolutionTemplate(value: unknown): value is SolutionTemplate {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    (record.description === undefined || typeof record.description === "string") &&
    Array.isArray(record.playbookFiles) &&
    record.playbookFiles.every((file) => typeof file === "string") &&
    (record.loopFiles === undefined ||
      (Array.isArray(record.loopFiles) && record.loopFiles.every((file) => typeof file === "string"))) &&
    (record.configFiles === undefined ||
      (Array.isArray(record.configFiles) && record.configFiles.every((file) => typeof file === "string"))) &&
    typeof record.createdAt === "string"
  );
}

function validateRepoRelativePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("..")) {
    throw new Error(`配置文件路径必须是仓相对路径：${path}`);
  }
  return trimmed;
}

function readFrontmatterId(md: string): string | null {
  return readFrontmatterValue(md, "id") ?? null;
}

function readFrontmatterValue(md: string, key: string): string | undefined {
  const block = firstFrontmatterBlock(md);
  if (!block) return undefined;
  const escapedKey = escapeRegExp(key);
  const pattern = new RegExp(`^${escapedKey}:\\s*(.+?)\\s*$`);
  for (const line of block.raw.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (match) return match[1].trim();
  }
  return undefined;
}

function removeProjectIdFromFrontmatter(md: string): string {
  const block = firstFrontmatterBlock(md);
  if (!block) return md;

  const nextRaw = block.raw
    .split(/\r?\n/)
    .filter((line) => !/^projectId:\s*.*$/.test(line))
    .join("\n");
  return `${md.slice(0, block.contentStart)}${nextRaw}\n${md.slice(block.contentEnd)}`;
}

function upsertProjectIdInFrontmatter(md: string, projectId: string): string {
  const block = firstFrontmatterBlock(md);
  if (!block) return `---\nprojectId: ${projectId}\n---\n${md}`;

  const lines = block.raw.split(/\r?\n/);
  const projectLine = `projectId: ${projectId}`;
  const existing = lines.findIndex((line) => /^projectId:\s*.*$/.test(line));
  if (existing >= 0) {
    lines[existing] = projectLine;
  } else {
    lines.push(projectLine);
  }
  return `${md.slice(0, block.contentStart)}${lines.join("\n")}\n${md.slice(block.contentEnd)}`;
}

function firstFrontmatterBlock(md: string): FrontmatterBlock | null {
  const normalized = md.replace(/^\uFEFF/, "");
  const bomOffset = md.length - normalized.length;
  const firstLineEnd = normalized.indexOf("\n");
  if (firstLineEnd === -1 || normalized.slice(0, firstLineEnd).trim() !== "---") return null;

  let lineStart = firstLineEnd + 1;
  while (lineStart <= normalized.length) {
    const lineEnd = normalized.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? normalized.length : lineEnd;
    if (normalized.slice(lineStart, end).trim() === "---") {
      return {
        contentStart: bomOffset + firstLineEnd + 1,
        contentEnd: bomOffset + lineStart,
        raw: normalized.slice(firstLineEnd + 1, lineStart).replace(/\r?\n$/, ""),
      };
    }
    if (lineEnd === -1) return null;
    lineStart = lineEnd + 1;
  }
  return null;
}

function readTemplateLoopForSave(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const cleaned: Record<string, unknown> = { ...(parsed as Record<string, unknown>), waves: [] };
    delete cleaned.projectId;
    return cleaned;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ApplyTargetEntry {
  id: string;
  repoPath: string;
}

export function resolveApplyTargetRepo(
  projectId: string,
  registry: ApplyTargetEntry[],
  explicitRepo: string | undefined,
): string {
  const entry = registry.find((candidate) => candidate.id === projectId);
  if (entry && entry.repoPath.trim() !== "") return entry.repoPath;
  if (explicitRepo && explicitRepo.trim() !== "") return explicitRepo;
  throw new Error(`项目 ${projectId} 不在注册表且未显式 --repo,拒绝写入 cwd`);
}
