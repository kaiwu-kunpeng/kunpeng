import { describe, expect, test } from "vitest";
import { defaultMergeReview, reviewMergeDiff } from "../src/runtime/merge-review.js";

const ctx = (diff: string) => ({ repoRoot: "/tmp", flowId: "probe", base: "main", diff });

function diffFor(path: string, bodyLines: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,3 +1,5 @@",
    " # 头部上下文",
    ...bodyLines,
    "",
  ].join("\n");
}

describe("parseDiff 必须区分文件头与 hunk 正文", () => {
  test("正常改 AGENTS.md 仍然拦截（不回归）", async () => {
    const r = await defaultMergeReview(ctx(diffFor("AGENTS.md", ["+新增一条规则"])));
    expect(r.block).toBe(true);
    expect((r.findings ?? []).join("\n")).toContain("AGENTS.md");
  });

  test("正文行以 '++ ' 开头时，保护文件门不得失效", async () => {
    const r = await defaultMergeReview(
      ctx(diffFor("AGENTS.md", ["+++ docs/notes.md", "+新增一条规则"])),
    );
    expect(r.block).toBe(true);
    expect((r.findings ?? []).join("\n")).toContain("AGENTS.md");
  });

  test("constitution/core.md 同样不得被 '++ ' 正文绕过", async () => {
    const r = await defaultMergeReview(
      ctx(diffFor("constitution/core.md", ["+++ docs/anything.md", "+改写不可变核心"])),
    );
    expect(r.block).toBe(true);
  });

  test("被误判成文件头的那行，正文必须进 added（继续参与密钥扫描）", () => {
    const res = reviewMergeDiff(
      ctx(diffFor("docs/notes.md", ['++ password: "super-secret-value-123"'].map((l) => `+${l}`))),
    );
    const joined = JSON.stringify(res.details ?? []);
    expect(joined).toContain("secret");
  });

  test("以 '-- ' 开头的正文行不得被当成文件头", () => {
    const files = reviewMergeDiff(ctx(diffFor("AGENTS.md", ["--- a/docs/other.md", "+新增"])));
    expect(files.block).toBe(true);
  });

  test("非保护文件 + 正文含 '++ ' 行，仍应放行（不得误拦）", async () => {
    const r = await defaultMergeReview(
      ctx(diffFor("docs/notes.md", ["+++ docs/elsewhere.md", "+普通文档内容"])),
    );
    expect(r.block).toBe(false);
  });

  test("多文件 diff 的路径归属不回归", () => {
    const diff = [
      diffFor("docs/a.md", ["+++ 伪装成文件头", "+甲文件内容"]).trimEnd(),
      diffFor("AGENTS.md", ["+乙文件内容"]).trimEnd(),
      "",
    ].join("\n");
    const r = reviewMergeDiff(ctx(diff));
    expect(r.block).toBe(true);
    expect(JSON.stringify(r.details ?? [])).toContain("AGENTS.md");
  });
});