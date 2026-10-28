import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const git = (...args: string[]): string => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const lines = (text: string): string[] => text.split("\n").filter(Boolean);

describe(".kunpeng/state-archive 不再由 git 跟踪（作者锁定）", () => {
  it("没有任何 state-archive 文件仍被跟踪在工作树里（已取消跟踪或已从工作树移除）", () => {
    const cached = new Set(lines(git("ls-files", "--cached", "--", ".kunpeng/state-archive")));
    const deleted = new Set(lines(git("ls-files", "--deleted", "--", ".kunpeng/state-archive")));
    const stillTracked = [...cached].filter((file) => !deleted.has(file));
    expect(stillTracked.slice(0, 5)).toEqual([]);
    expect(stillTracked.length).toBe(0);
  });

  it(".gitignore 忽略 state-archive 下的新文件，运行时归档不会再被 add -A 带进提交", () => {
    const hit = git("check-ignore", "--no-index", "-v", ".kunpeng/state-archive/2026-09-24/some-flow.json");
    expect(hit).toContain(".kunpeng/state-archive");
  });

  it("相邻的运行时目录规则还在（没把 .gitignore 改坏）", () => {
    expect(git("check-ignore", "--no-index", ".kunpeng/state/x.json").trim()).toBe(".kunpeng/state/x.json");
    expect(git("check-ignore", "--no-index", ".kunpeng/accept-logs/f/1.txt").trim()).toBe(".kunpeng/accept-logs/f/1.txt");
  });
});