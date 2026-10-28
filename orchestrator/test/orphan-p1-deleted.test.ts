import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("P1 孤儿判决清退", () => {
  it("learn/digest 模块与四个测试已删除", () => {
    expect(existsSync(join(root, "src", "knowledge", "learn.ts"))).toBe(false);
    expect(existsSync(join(root, "src", "knowledge", "digest.ts"))).toBe(false);
    expect(existsSync(join(root, "test", "validate-insights.test.ts"))).toBe(false);
    expect(existsSync(join(root, "test", "meta-learn.test.ts"))).toBe(false);
    expect(existsSync(join(root, "test", "knowledge-digest.test.ts"))).toBe(false);
    expect(existsSync(join(root, "test", "knowledge-distill.test.ts"))).toBe(false);
  });
  it("正身仍在(failures 链路与 lesson-distill)", () => {
    expect(existsSync(join(root, "src", "evolution", "failure-digest.ts"))).toBe(true);
    expect(existsSync(join(root, "src", "knowledge", "lesson-distill.ts"))).toBe(true);
  });
});