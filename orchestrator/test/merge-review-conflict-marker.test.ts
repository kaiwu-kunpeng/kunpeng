import { describe, it, expect } from "vitest";
import { reviewMergeDiff } from "../src/runtime/merge-review.js";

const baseCtx = { repoRoot: "/tmp/repo", flowId: "f1", base: "main" };

// 动态构造标记,源码内不出现字面 7 连标记(否则旧版合并门会误拦本修复自身)
const LT = "<".repeat(7);
const EQ = "=".repeat(7);
const GT = ">".repeat(7);

function diffWithAdded(line: string): string {
  return [
    "diff --git a/src/x.ts b/src/x.ts",
    "index 1111111..2222222 100644",
    "--- a/src/x.ts",
    "+++ b/src/x.ts",
    "@@ -1 +1 @@",
    "-old",
    `+${line}`,
  ].join("\n");
}

function flaggedAsConflict(line: string): boolean {
  const r = reviewMergeDiff({ ...baseCtx, diff: diffWithAdded(line) });
  return r.details.some((d) => d.issue === "diff 中残留冲突标记");
}

describe("merge-review 冲突标记:只认行首真标记,不误伤字面量", () => {
  it("行首真 git 冲突标记被拦", () => {
    expect(flaggedAsConflict(`${LT} HEAD`)).toBe(true);
    expect(flaggedAsConflict(EQ)).toBe(true);
    expect(flaggedAsConflict(`${GT} feature-branch`)).toBe(true);
  });

  it("源码里行中段的正则/字符串字面量不被误判", () => {
    expect(flaggedAsConflict(`  patterns: [/x{7,}/, /y${EQ}z/],`)).toBe(false);
    expect(flaggedAsConflict(`const divider = "${EQ}${EQ}";`)).toBe(false);
    expect(flaggedAsConflict(`foo ${LT} bar`)).toBe(false);
  });

  it("超过 7 连(注释分隔线等)不被误判", () => {
    expect(flaggedAsConflict("=".repeat(20))).toBe(false);
    expect(flaggedAsConflict("<".repeat(10) + " x")).toBe(false);
  });
});