import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertProductSlug } from "./slug-guard.js";

export interface WorkspaceVersion {
  sha: string;
  message: string;
  at: number;
}

const GIT_IDENTITY_ARGS = [
  "-c",
  "user.name=kunpeng",
  "-c",
  "user.email=kunpeng@local",
] as const;

const WORKSPACE_GITIGNORE = "node_modules/\ndist/\n.DS_Store\n";

export function productWorkspaceDir(repoRoot: string, slug: string): string {
  return join(repoRoot, "products", assertProductSlug(slug));
}

export async function ensureWorkspace(repoRoot: string, slug: string): Promise<string> {
  await mkdir(repoRoot, { recursive: true });
  await ensureHostProductsIgnored(repoRoot);

  const workspaceDir = productWorkspaceDir(repoRoot, slug);
  await mkdir(workspaceDir, { recursive: true });

  if (!(await pathExists(join(workspaceDir, ".git")))) {
    await runGit(workspaceDir, ["init", "-b", "main"]);
    await writeFile(join(workspaceDir, ".gitignore"), WORKSPACE_GITIGNORE);
    await runGit(workspaceDir, ["add", ".gitignore"]);
    await runGit(workspaceDir, ["commit", "--allow-empty", "-m", "init workspace"]);
  }

  return workspaceDir;
}

export async function commitWorkspaceVersion(
  repoRoot: string,
  slug: string,
  message: string,
): Promise<string | undefined> {
  const workspaceDir = productWorkspaceDir(repoRoot, slug);
  if (!(await pathExists(join(workspaceDir, ".git")))) return undefined;

  try {
    await runGit(workspaceDir, ["add", "-A"]);
    const status = await runGit(workspaceDir, ["status", "--porcelain"]);
    if (status.trim() === "") return undefined;
    await runGit(workspaceDir, ["commit", "-m", message]);
    return (await runGit(workspaceDir, ["rev-parse", "HEAD"])).trim();
  } catch {
    return undefined;
  }
}

export async function listWorkspaceVersions(
  repoRoot: string,
  slug: string,
  limit = 20,
): Promise<WorkspaceVersion[]> {
  const workspaceDir = productWorkspaceDir(repoRoot, slug);
  if (limit <= 0 || !(await pathExists(join(workspaceDir, ".git")))) return [];

  try {
    const raw = await runGit(workspaceDir, [
      "log",
      `-n${Math.floor(limit)}`,
      "--format=%H%x1f%s%x1f%ct%x1e",
    ]);
    return parseVersions(raw);
  } catch {
    return [];
  }
}

export async function restoreWorkspaceVersion(
  repoRoot: string,
  slug: string,
  sha: string,
): Promise<string | undefined> {
  const workspaceDir = productWorkspaceDir(repoRoot, slug);
  if (!(await pathExists(join(workspaceDir, ".git")))) return undefined;

  await commitWorkspaceVersion(repoRoot, slug, "恢复前自动存");

  try {
    await runGit(workspaceDir, ["checkout", sha, "--", "."]);
  } catch {
    return undefined;
  }

  return commitWorkspaceVersion(repoRoot, slug, `恢复到 ${sha.slice(0, 8)}`);
}

async function ensureHostProductsIgnored(repoRoot: string): Promise<void> {
  const gitignorePath = join(repoRoot, ".gitignore");
  let content = "";
  try {
    content = await readFile(gitignorePath, "utf8");
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }

  if (content.split(/\r?\n/).some((line) => line.trim() === "products/")) return;
  const prefix = content === "" || content.endsWith("\n") ? content : `${content}\n`;
  await writeFile(gitignorePath, `${prefix}products/\n`);
}

function parseVersions(raw: string): WorkspaceVersion[] {
  return raw
    .split("\x1e")
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .flatMap((record) => {
      const [sha, message, timestamp] = record.split("\x1f");
      if (!sha || message === undefined || !timestamp) return [];
      const seconds = Number(timestamp);
      if (!Number.isFinite(seconds)) return [];
      return [{ sha, message, at: seconds * 1000 }];
    });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...GIT_IDENTITY_ARGS, ...args],
      { cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
