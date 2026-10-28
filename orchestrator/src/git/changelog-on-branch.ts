import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { addEntry, type ChangelogCategory } from "../dossier/changelog.js";
import { gitWithWallClock } from "./git-wall.js";

/** 仅在流分支的隔离工作树提交，调用方用合并锁串行化。 */
export async function appendChangelogOnBranch(
  repoRoot: string,
  branch: string,
  item: { category: ChangelogCategory; entry: string },
): Promise<{ status: "appended" | "already-present" | "no-changelog" | "error"; error?: string }> {
  const tmp = join(repoRoot, ".kunpeng", "changelog-tmp");
  try {
    const git = gitWithWallClock(repoRoot);
    const current = (await git.branchLocal()).current;
    if (branch === "main" || branch === "refs/heads/main" || branch === current || branch === `refs/heads/${current}`) {
      return { status: "error", error: `不能在 main 或主工作树当前分支 ${branch} 上追加 CHANGELOG` };
    }
    // 没有残留时 remove 会报错；已有目录清理失败则不能继续覆盖它。
    await git.raw(["worktree", "remove", "--force", tmp]).catch((error: unknown) => {
      if (existsSync(tmp)) throw error;
    });
    try {
      await git.raw(["worktree", "add", "-f", tmp, branch]);
      const path = join(tmp, "CHANGELOG.md");
      let existing: string;
      try {
        existing = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "no-changelog" };
        throw error;
      }
      if (existing.split(/\r?\n/).includes(`- ${item.entry}`)) return { status: "already-present" };
      await writeFile(path, addEntry(existing, item.category, item.entry), "utf8");
      const wt = gitWithWallClock(tmp);
      await wt.add("CHANGELOG.md");
      await wt.commit(`docs(changelog): ${item.entry}`, ["CHANGELOG.md"]);
      return { status: "appended" };
    } finally {
      await git.raw(["worktree", "remove", "--force", tmp]).catch((error: unknown) => {
        if (existsSync(tmp)) throw error;
      });
    }
  } catch (error) {
    return { status: "error", error: String(error) };
  }
}
