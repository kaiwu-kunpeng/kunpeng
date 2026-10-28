import { describe, expect, test } from "vitest";
import { defaultMergeReview, reviewMerge, reviewMergeDiff } from "../src/runtime/merge-review.js";

const baseCtx = {
  repoRoot: "/tmp/repo",
  flowId: "f1",
  base: "main",
};

function diffFor(path: string, added: string, removed = "old"): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    `-${removed}`,
    `+${added}`,
  ].join("\n");
}

describe("reviewMergeDiff", () => {
  test("passes a normal text diff", () => {
    const result = reviewMergeDiff({
      ...baseCtx,
      diff: diffFor("src/runtime/example.ts", "export const value = 1;"),
    });

    expect(result.block).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.details).toEqual([]);
  });

  test("blocks missing merge context and empty diff", () => {
    const result = reviewMergeDiff({
      repoRoot: "/tmp/repo",
      flowId: " ",
      base: " ",
      diff: " ",
    });

    expect(result.block).toBe(true);
    expect(result.findings).toEqual([
      "(merge): flowId 为空 (flowId was blank)",
      "(merge): base 为空 (base was blank)",
      "(diff): 待合并 diff 为空 (git diff returned no content)",
    ]);
  });

  test("blocks protected governance files", () => {
    const result = reviewMergeDiff({
      ...baseCtx,
      diff: diffFor("constitution/core.md", "C10 forbidden"),
    });

    expect(result.block).toBe(true);
    expect(result.details).toContainEqual(
      expect.objectContaining({
        severity: "error",
        file: "constitution/core.md",
        issue: "改动触及宪法/角色卡/AGENTS/技能规则，属于人工门 #2 范围",
      }),
    );
  });

  test("blocks added secrets without reporting removed secrets", () => {
    const result = reviewMergeDiff({
      ...baseCtx,
      diff: [
        "diff --git a/.env.example b/.env.example",
        "index 1111111..2222222 100644",
        "--- a/.env.example",
        "+++ b/.env.example",
        "@@ -1,2 +1,2 @@",
        "-OPENAI_API_KEY=\"sk-removed-secret-that-should-not-count\"",
        "+OPENAI_API_KEY=\"sk-added-secret-that-must-block\"",
      ].join("\n"),
    });

    expect(result.block).toBe(true);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toMatchObject({
      file: ".env.example",
      issue: "新增内容疑似包含 OpenAI API key",
    });
  });

  test("blocks conflict markers and binary patches", () => {
    const result = reviewMergeDiff({
      ...baseCtx,
      diff: [
        "diff --git a/src/a.ts b/src/a.ts",
        "index 1111111..2222222 100644",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1 +1 @@",
        "-old",
        "+<<<<<<< HEAD",
        "diff --git a/assets/logo.png b/assets/logo.png",
        "new file mode 100644",
        "index 0000000..2222222",
        "GIT binary patch",
      ].join("\n"),
    });

    expect(result.block).toBe(true);
    expect(result.details.map((detail) => detail.issue)).toEqual([
      "diff 中残留冲突标记",
      "二进制补丁无法用文本审查证明安全",
    ]);
  });

  test("async exports delegate to the same reviewer", async () => {
    const ctx = { ...baseCtx, diff: diffFor("src/runtime/example.ts", "ok") };

    await expect(reviewMerge(ctx)).resolves.toEqual(reviewMergeDiff(ctx));
    await expect(defaultMergeReview(ctx)).resolves.toEqual(reviewMergeDiff(ctx));
  });
});

test("测试文件的假口令豁免 generic 规则,高精度规则仍拦", () => {
  const mk = (path: string, line: string) => [
    `diff --git a/${path} b/${path}`,
    "index 000..111 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -0,0 +1 @@",
    `+${line}`,
  ].join("\n");
  const fake = 'createUser(db, { username: "u1", password: "long-enough-1", role: "viewer" }, "s1");';
  // 单测里的假口令:不拦
  const exempt = reviewMergeDiff({ repoRoot: "/repo", flowId: "f", base: "main", diff: mk("lib/users.test.mjs", fake) });
  expect(exempt.block).toBe(false);
  // 同一行落在产品代码:仍拦
  const prod = reviewMergeDiff({ repoRoot: "/repo", flowId: "f", base: "main", diff: mk("lib/users.ts", fake) });
  expect(prod.block).toBe(true);
  // 高精度规则(GitHub token)在测试文件里也拦
  const gh = reviewMergeDiff({ repoRoot: "/repo", flowId: "f", base: "main", diff: mk("lib/users.test.mjs", 'const t = "ghp_0123456789abcdefghij0123456789";') });
  expect(gh.block).toBe(true);
});
