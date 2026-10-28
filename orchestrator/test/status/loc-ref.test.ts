import { describe, it, expect } from "vitest";
import { parseGrepLineCounts, countLinesFromRef } from "../../src/status/loc-ref.js";

describe("parseGrepLineCounts", () => {
  it("取每行最后一个冒号后的计数求和", () => {
    expect(parseGrepLineCounts("main:a/b.ts:10\nmain:c/d.ts:5")).toBe(15);
  });
  it("忽略空行/无冒号的杂行", () => {
    expect(parseGrepLineCounts("main:x.ts:3\n\ngarbage\nmain:y.ts:7\n")).toBe(10);
  });
  it("空输入 → 0", () => {
    expect(parseGrepLineCounts("")).toBe(0);
  });
});

describe("countLinesFromRef", () => {
  it("通过 git.raw 求和", async () => {
    const fakeGit = { raw: async () => "main:a.ts:4\nmain:b.ts:6" } as unknown as Parameters<typeof countLinesFromRef>[0];
    expect(await countLinesFromRef(fakeGit, "main", "x")).toBe(10);
  });
});
