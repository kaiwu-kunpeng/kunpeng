import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const testSrc = readFileSync(join(root, "src", "loop", "driver.test.ts"), "utf8");

describe("driver.test 台账隔离(作者验收)", () => {
  it("runLoopWave 用例注入临时 repoRoot", () => {
    expect(testSrc).toContain("mkdtemp");
    expect(testSrc).toContain("repoRoot");
  });
  it("没有用 guardDisabled 绕过护栏", () => {
    expect(testSrc.includes("guardDisabled: true")).toBe(false);
  });
  it("测试跑完仓库树无台账残渣", () => {
    expect(existsSync(join(root, ".kunpeng", "state", "ops", "actions.jsonl"))).toBe(false);
  });
});