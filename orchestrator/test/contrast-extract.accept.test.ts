import { describe, expect, it } from "vitest";
import { buildContrastPrompt, parseContrastLessons } from "../src/knowledge/lesson-distill.js";

const failed = "跑 vitest\n错误: scope 块解析为空\n中止";
const passed = "跑 vitest\nscope 块逐行 allow 解析成功\nverified";
const good = "# Lesson\n## Title scope 块必须逐行 allow\n## Description 写 spec scope 时用\n## Content YAML 列表写法会静默解析为空,必须每行 allow: 单 glob。\n## Evidence FAIL: 错误: scope 块解析为空 / PASS: scope 块逐行 allow 解析成功\n";

describe("对比提取(作者验收)", () => {
  it("对比 prompt 纪律齐全", () => {
    const p = buildContrastPrompt({ goal: "g", failedTail: failed, succeededTail: passed });
    expect(p).toContain("最多提取 2 条");
    expect(p).toContain("FAIL:");
    expect(p).toContain("PASS:");
    expect(p).toContain("NO_LESSON");
  });
  it("双边逐字证据强制:任一边引不出即丢弃", () => {
    const ok = parseContrastLessons(good, { failedTail: failed, succeededTail: passed, sourceIds: ["a", "b"] } as never);
    expect(ok.length).toBe(1);
    expect(ok[0]!.polarity).toBe("contrast");
    expect(ok[0]!.trustTier).toBe(2);
    const badFail = good.replace("错误: scope 块解析为空", "我猜是权限问题");
    expect(parseContrastLessons(badFail, { failedTail: failed, succeededTail: passed, sourceIds: [] } as never).length).toBe(0);
    const badPass = good.replace("scope 块逐行 allow 解析成功", "总之后来就好了");
    expect(parseContrastLessons(badPass, { failedTail: failed, succeededTail: passed, sourceIds: [] } as never).length).toBe(0);
  });
});