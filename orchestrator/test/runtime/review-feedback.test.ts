import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  feedbackPath,
  readFeedback,
  addFeedback,
  clearFeedback,
  formatFeedbackForPrompt,
} from "../../src/runtime/review-feedback.js";

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-fb-")); });
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe("review-feedback store", () => {
  it("path 在 <repo>/.kunpeng/review-feedback/<flowId>.json（避开 ReinjectStore 的 .kunpeng/feedback）", () => {
    expect(feedbackPath("/r", "f1")).toBe(join("/r", ".kunpeng", "review-feedback", "f1.json"));
  });

  it("未写时 readFeedback=[]", async () => {
    expect(await readFeedback(repo, "f1")).toEqual([]);
  });

  it("add 累加,read 取回,clear 清空", async () => {
    await addFeedback(repo, "f1", { comment: "改用 const", file: "a.ts", line: 12 });
    await addFeedback(repo, "f1", { comment: "补边界测试" });
    const got = await readFeedback(repo, "f1");
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ comment: "改用 const", file: "a.ts", line: 12 });
    expect(got[1]).toMatchObject({ comment: "补边界测试" });
    await clearFeedback(repo, "f1");
    expect(await readFeedback(repo, "f1")).toEqual([]);
  });

  it("clear 不存在不抛", async () => {
    await expect(clearFeedback(repo, "nope")).resolves.toBeUndefined();
  });

  it("多 flowId 隔离", async () => {
    await addFeedback(repo, "a", { comment: "x" });
    expect(await readFeedback(repo, "a")).toHaveLength(1);
    expect(await readFeedback(repo, "b")).toEqual([]);
  });
});

describe("formatFeedbackForPrompt", () => {
  it("空 → 空串", () => {
    expect(formatFeedbackForPrompt([])).toBe("");
  });
  it("拼成带标题的中文意见块,带/不带 file/line", () => {
    const out = formatFeedbackForPrompt([
      { comment: "改用 const", file: "a.ts", line: 12 },
      { comment: "文件级意见", file: "b.ts" },
      { comment: "整体意见" },
    ]);
    expect(out).toContain("人工审查意见");
    expect(out).toContain("[a.ts:12] 改用 const");
    expect(out).toContain("[b.ts] 文件级意见");
    expect(out).toContain("- 整体意见");
  });
});