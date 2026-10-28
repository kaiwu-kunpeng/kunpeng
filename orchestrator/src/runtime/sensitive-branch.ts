import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { contentSensitiveHits, SENSITIVE_DIFF_MAX_BUFFER, SENSITIVE_DIFF_TIMEOUT_MS } from "./sensitive-content.js";
import { classifySensitiveFiles, type SensitiveHit } from "./sensitive-paths.js";

export { SENSITIVE_DIFF_MAX_BUFFER, SENSITIVE_DIFF_TIMEOUT_MS } from "./sensitive-content.js";

export type GitDiffRunner = (
  file: string,
  args: string[],
  opts: { cwd: string; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string | Buffer }>;

const execFileAsync = promisify(execFile);

const defaultGitDiffRunner: GitDiffRunner = async (file, args, opts) => {
  return execFileAsync(file, args, opts);
};

export async function changedFilesForBranch(
  repoRoot: string,
  flowId: string,
  base: string,
  run: GitDiffRunner = defaultGitDiffRunner,
): Promise<string[]> {
  const { stdout } = await run(
    "git",
    ["diff", "--no-renames", "--name-only", `${base}...kp/${flowId}`],
    { cwd: repoRoot, timeout: SENSITIVE_DIFF_TIMEOUT_MS, maxBuffer: SENSITIVE_DIFF_MAX_BUFFER },
  );
  const output = Buffer.isBuffer(stdout) ? stdout.toString("utf8") : stdout;
  return output.split(/\r?\n/).filter((line) => line.trim() !== "");
}

export async function sensitiveHitsForBranch(
  repoRoot: string,
  flowId: string,
  base: string,
  run?: GitDiffRunner,
): Promise<SensitiveHit[]> {
  const pathHits = classifySensitiveFiles(await changedFilesForBranch(repoRoot, flowId, base, run)).hits;
  const git = run ? async (args: string[]): Promise<string> => {
    const { stdout } = await run("git", args, {
      cwd: repoRoot, timeout: SENSITIVE_DIFF_TIMEOUT_MS, maxBuffer: SENSITIVE_DIFF_MAX_BUFFER,
    });
    return Buffer.isBuffer(stdout) ? stdout.toString("utf8") : stdout;
  } : undefined;
  const contentHits = await contentSensitiveHits(repoRoot, flowId, base, git);
  const seen = new Set<string>();
  return [...pathHits, ...contentHits].filter((hit) => {
    const key = `${hit.file}\0${hit.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
