import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeIntoMainAtomic } from "../../src/git/merge-main-atomic.js";

let repo: string;
let g: SimpleGit;

async function commitFile(path: string, content: string, message: string): Promise<void> {
  writeFileSync(join(repo, path), content);
  await g.add(".");
  await g.commit(message);
}

async function branchWith(name: string, file: string): Promise<void> {
  await g.checkout(["-b", name, "main"]);
  await commitFile(file, `${name}\n`, name);
  await g.checkout("main");
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-merge-atomic-conc-"));
  g = simpleGit(repo);
  await g.init();
  await g.checkoutLocalBranch("main");
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  await commitFile("a.txt", "base\n", "init");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("临时 worktree 不再共用固定路径", () => {
  it("固定路径被别人占着时照常合并，且不动别人的目录", async () => {
    await branchWith("kp/a", "fa.txt");
    // 建完分支再放占位目录：commitFile 的 add(".") 会把它提交进分支。
    const foreign = join(repo, ".kunpeng", "merge-atomic-tmp");
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, "keep.txt"), "someone else's merge\n");

    const r = await mergeIntoMainAtomic(repo, "kp/a");

    expect(r.ok).toBe(true);
    expect(readFileSync(join(foreign, "keep.txt"), "utf8")).toBe("someone else's merge\n");
  });

  it("两个合并并发进行都成功，结束后无残留", async () => {
    await g.branch(["int-x", "main"]);
    await g.branch(["int-y", "main"]);
    await branchWith("kp/x", "fx.txt");
    await branchWith("kp/y", "fy.txt");

    const [rx, ry] = await Promise.all([
      mergeIntoMainAtomic(repo, "kp/x", "int-x"),
      mergeIntoMainAtomic(repo, "kp/y", "int-y"),
    ]);

    expect(rx.ok).toBe(true);
    expect(ry.ok).toBe(true);
    expect((await g.raw(["ls-tree", "--name-only", "int-x"])).split("\n")).toContain("fx.txt");
    expect((await g.raw(["ls-tree", "--name-only", "int-y"])).split("\n")).toContain("fy.txt");
    const kp = join(repo, ".kunpeng");
    const leftovers = existsSync(kp) ? readdirSync(kp).filter((n) => n.startsWith("merge-atomic-tmp")) : [];
    expect(leftovers).toEqual([]);
    const worktrees = (await g.raw(["worktree", "list", "--porcelain"])).split("\n").filter((l) => l.startsWith("worktree "));
    expect(worktrees).toHaveLength(1);
  });

  it("冲突时只清理本次临时目录", async () => {
    await g.checkout(["-b", "kp/c", "main"]);
    await commitFile("a.txt", "branch\n", "branch change");
    await g.checkout("main");
    await commitFile("a.txt", "main\n", "main change");

    const r = await mergeIntoMainAtomic(repo, "kp/c");

    expect(r.conflict).toBe(true);
    const kp = join(repo, ".kunpeng");
    expect(existsSync(kp) ? readdirSync(kp).filter((n) => n.startsWith("merge-atomic-tmp")) : []).toEqual([]);
  });
});