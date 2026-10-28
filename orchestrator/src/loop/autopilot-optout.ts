import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { canonicalRepoRoot } from "../project/state-resolve.js";

export const AUTOPILOT_OPTOUT_FILE = ".kunpeng/autopilot-disabled";
export const AUTOPILOT_OPTOUT_REASON_PREFIX = "autopilot 已对本仓停用：";
export const AUTOPILOT_OPTOUT_DEFAULT_TEXT = "仓库存在 .kunpeng/autopilot-disabled 标记";

export type AutopilotOptOut = { disabled: false } | { disabled: true; reason: string };

function runGit(root: string): string | null {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "--git-common-dir"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export async function readAutopilotOptOut(repoRoot: string): Promise<AutopilotOptOut> {
  const canonical = canonicalRepoRoot(repoRoot, { runGit });
  const roots = canonical === repoRoot ? [repoRoot] : [repoRoot, canonical];
  for (const root of roots) {
    try {
      const marker = join(root, AUTOPILOT_OPTOUT_FILE);
      const info = await stat(marker);
      let text = AUTOPILOT_OPTOUT_DEFAULT_TEXT;
      if (info.isFile()) {
        try {
          const content = (await readFile(marker, "utf8")).replace(/\s+/g, " ").trim();
          text = content.length > 200 ? content.slice(0, 200) + "…" : content || text;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException)?.code ?? "UNKNOWN";
          text = `停用标记不可读取（${code}），保守按停用处理`;
        }
      }
      return { disabled: true, reason: AUTOPILOT_OPTOUT_REASON_PREFIX + text };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code ?? "UNKNOWN";
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      return {
        disabled: true,
        reason: AUTOPILOT_OPTOUT_REASON_PREFIX + `停用标记不可检查（${code}），保守按停用处理`,
      };
    }
  }
  return { disabled: false };
}
