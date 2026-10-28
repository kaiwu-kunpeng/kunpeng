import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFeedback, readFeedbackSummary, kpBeaconSnippet } from "../../src/product/ops-kit.js";

describe("反馈落盘与摘要", () => {
  let root: string;
  const slug = "demo";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kp-fb-"));
    mkdirSync(join(root, ".kunpeng", "product", slug), { recursive: true });
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("append→summary 回环：计数/均分/recent 新的在前/裁剪", async () => {
    const now = 10_000_000_000;
    expect(await appendFeedback(root, slug, { score: 5, comment: "很好用" }, now - 3000)).toBe(true);
    expect(await appendFeedback(root, slug, { score: 2, comment: "x".repeat(900) }, now - 2000)).toBe(true);
    expect(await appendFeedback(root, slug, { score: 5 }, now - 1000)).toBe(true);
    const s = await readFeedbackSummary(root, slug, { now });
    expect(s?.count).toBe(3);
    expect(s?.avgScore).toBe(4);
    expect(s?.recent.length).toBe(3);
    expect(s?.recent[0].at).toBe(now - 1000);
    expect((s?.recent[1].comment ?? "").length).toBeLessThanOrEqual(500);
  });

  it("拒收：非法 score/目录不存在；窗口外/缺文件 undefined", async () => {
    const now = 10_000_000_000;
    expect(await appendFeedback(root, slug, { score: 0 }, now)).toBe(false);
    expect(await appendFeedback(root, slug, { score: 3.5 }, now)).toBe(false);
    expect(await appendFeedback(root, "ghost", { score: 3 }, now)).toBe(false);
    expect(await readFeedbackSummary(root, "ghost", { now })).toBeUndefined();
    expect(await appendFeedback(root, slug, { score: 4 }, now - 10 * 86_400_000)).toBe(true);
    expect(await readFeedbackSummary(root, slug, { now })).toBeUndefined();
  });
});

describe("kpBeaconSnippet 反馈组件", () => {
  it("含反馈组件与拾取互斥", () => {
    const snippet = kpBeaconSnippet("demo", "http://localhost:7788", "test-token");
    expect(snippet).toContain("feedback");
    expect(snippet).toContain("反馈");
    expect(snippet).toContain("kp-pick");
  });
});
