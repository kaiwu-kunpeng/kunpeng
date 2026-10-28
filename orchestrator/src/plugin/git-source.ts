import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

/** git 来源：url 只收 https / ssh / git@ / file 四种形态；commit 必须是 40 位十六进制（钉版，与 kpkg 的 sha256 同一纪律）。 */
export const GIT_URL_PATTERN = /^(?:https?:\/\/|ssh:\/\/|git@|file:\/\/)/;
export const GIT_COMMIT_PATTERN = /^[0-9a-fA-F]{40}$/;

export type RunGit = (args: string[]) => string;

const defaultRunGit: RunGit = (args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });

export function isGitUrl(value: string): boolean {
  return GIT_URL_PATTERN.test(value);
}

/** 缓存目录名：<仓库名>-<commit 前 12 位>，仓库名只留小写字母/数字/连字符。 */
export function gitCacheDir(pluginsRoot: string, url: string, commit: string): string {
  const repo = basename(url.replace(/\/+$/, "")).replace(/\.git$/, "").toLowerCase().replace(/[^a-z0-9-]/g, "-") || "repo";
  return join(pluginsRoot, "cache", `${repo}-${commit.slice(0, 12).toLowerCase()}`);
}

/** 读目录 HEAD（小写 40 位）；不是 git 仓或 git 不可用时返回 undefined，交调用方决定告警。 */
export function gitHeadOf(dir: string, runGit: RunGit = defaultRunGit): string | undefined {
  try {
    const head = runGit(["-C", dir, "rev-parse", "HEAD"]).trim().toLowerCase();
    return GIT_COMMIT_PATTERN.test(head) ? head : undefined;
  } catch {
    return undefined;
  }
}

/** 把 git 来源物化成本地目录：clone 后 checkout 到钉死的 commit，并复核 HEAD；已是该 commit 的缓存直接复用（幂等）。 */
export function cloneGitSource(input: { url: string; commit: string; destDir: string; runGit?: RunGit }): string {
  const runGit = input.runGit ?? defaultRunGit;
  const commit = input.commit.toLowerCase();
  if (!isGitUrl(input.url)) throw new Error(`git 来源 url 须为 https/ssh/git@/file 地址：${input.url}`);
  if (!GIT_COMMIT_PATTERN.test(commit)) throw new Error(`git 来源必须钉 commit（40 位十六进制）：${input.commit}`);
  if (existsSync(join(input.destDir, ".git")) && gitHeadOf(input.destDir, runGit) === commit) return input.destDir;
  rmSync(input.destDir, { recursive: true, force: true });
  try {
    runGit(["clone", "-q", input.url, input.destDir]);
    runGit(["-C", input.destDir, "checkout", "-q", commit]);
  } catch (error: unknown) {
    rmSync(input.destDir, { recursive: true, force: true });
    throw new Error(`git 来源拉取失败（${input.url} @ ${commit.slice(0, 12)}）`, { cause: error });
  }
  const head = gitHeadOf(input.destDir, runGit);
  if (head !== commit) {
    rmSync(input.destDir, { recursive: true, force: true });
    throw new Error(`git 来源 checkout 后 HEAD（${head ?? "不可读"}）不等于钉死的 commit ${commit.slice(0, 12)}`);
  }
  return input.destDir;
}
