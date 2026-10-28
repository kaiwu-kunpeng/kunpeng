import { describe, expect, test } from "vitest";
import { defaultMergeReview } from "../src/runtime/merge-review.js";

const ctx = (diff: string) => ({ repoRoot: "/tmp", flowId: "probe", base: "main", diff });

function modifyDiff(path: string, body: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,3 +1,4 @@",
    " # 上下文",
    ...body,
    "",
  ].join("\n");
}

function renameDiff(from: string, to: string): string {
  return [
    `diff --git a/${from} b/${to}`,
    "similarity index 100%",
    `rename from ${from}`,
    `rename to ${to}`,
    "",
  ].join("\n");
}

describe("保护面加固", () => {
  test("H2：把 constitution/core.md 改名搬走必须拦截", async () => {
    const r = await defaultMergeReview(ctx(renameDiff("constitution/core.md", "docs/archive/old-core.md")));
    expect(r.block).toBe(true);
  });

  test("H2：AGENTS.md 改名搬走同样必须拦截", async () => {
    const r = await defaultMergeReview(ctx(renameDiff("AGENTS.md", "docs/archive/AGENTS.old.md")));
    expect(r.block).toBe(true);
  });

  test("H3：constitution/conventions.md 必须在保护名单内", async () => {
    const r = await defaultMergeReview(ctx(modifyDiff("constitution/conventions.md", ["+允许 || true"])));
    expect(r.block).toBe(true);
  });

  test("H3：constitution/core.md 仍然拦截（不回归）", async () => {
    const r = await defaultMergeReview(ctx(modifyDiff("constitution/core.md", ["+改写核心"])));
    expect(r.block).toBe(true);
  });

  test("H4：非空但解析不出文件的 diff 必须 fail-closed", async () => {
    const diff = [
      "diff --cc constitution/core.md",
      "index 1111111,2222222..3333333",
      "@@@ -1,3 -1,3 +1,4 @@@",
      "  # 上下文",
      "++改写核心",
      "",
    ].join("\n");
    const r = await defaultMergeReview(ctx(diff));
    expect(r.block).toBe(true);
    expect((r.findings ?? []).join("\n")).toContain("解析");
  });

  test("H1 不回归：正文含 '++ ' 行仍拦截 AGENTS.md", async () => {
    const r = await defaultMergeReview(ctx(modifyDiff("AGENTS.md", ["+++ docs/notes.md", "+新增规则"])));
    expect(r.block).toBe(true);
  });

  test("普通文件不得误拦", async () => {
    const r = await defaultMergeReview(ctx(modifyDiff("docs/notes.md", ["+普通文档内容"])));
    expect(r.block).toBe(false);
  });

  test("普通文件改名也不得误拦", async () => {
    const r = await defaultMergeReview(ctx(renameDiff("docs/a.md", "docs/b.md")));
    expect(r.block).toBe(false);
  });
});