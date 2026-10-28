import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { gateDiff, renderDiffHtml } from "../../src/server/gate-diff.js";

describe("renderDiffHtml", () => {
  it("着色 + 转义", () => {
    const h = renderDiffHtml("@@ -1 +1 @@\n+a<b>\n-x\n ctx");
    expect(h).toContain("kp-diff-add");
    expect(h).toContain("kp-diff-del");
    expect(h).toContain("kp-diff-hunk");
    expect(h).toContain("a&lt;b&gt;");
    expect(h).not.toContain("a<b>");
  });
});

describe("gateDiff", () => {
  it("返回 kp/<flow> 相对 main 的改动", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-gd-"));
    try {
      const git = simpleGit(repo);
      await git.init();
      await git.addConfig("user.email", "t@t.t");
      await git.addConfig("user.name", "t");
      writeFileSync(join(repo, "f.txt"), "base\n");
      await git.add(".");
      await git.commit("init");
      // 确保 main 名
      await git.branch(["-M", "main"]).catch(() => {});
      await git.checkoutLocalBranch("kp/flowX");
      writeFileSync(join(repo, "f.txt"), "base\nNEWLINE_MARK\n");
      await git.add(".");
      await git.commit("change");
      await git.checkout("main");
      const d = await gateDiff(repo, "flowX", "main");
      expect(d.ok).toBe(true);
      expect(d.files.map((f) => f.path)).toContain("f.txt");
      expect(d.html).toContain("NEWLINE_MARK");
    } finally { rmSync(repo, { recursive: true, force: true }); }
  }, 30000);
});
