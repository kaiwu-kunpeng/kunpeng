import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const memSrc = readFileSync(join(root, "src", "knowledge", "memory-context.ts"), "utf8");
const rwSrc = readFileSync(join(root, "src", "loop", "recipes", "agent-playbook", "runwave.ts"), "utf8");

describe("注入纪律(作者验收)", () => {
  it("BM25 默认收敛到 2 且带建议性前缀", () => {
    expect(memSrc).toContain("先判断是否与当前任务相关");
    expect(/=\s*2|:\s*2/.test(memSrc)).toBe(true);
  });
  it("runwave 渐进披露:超过2条只给 description", () => {
    expect(rwSrc).toContain("渐进披露");
    expect(rwSrc.includes("Read") || rwSrc.includes("读取完整内容")).toBe(true);
  });
});