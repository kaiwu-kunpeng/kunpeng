import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cmdSrc = readFileSync(join(root, "src", "server", "chat-commands.ts"), "utf8");
const clientSrc = clientSource();

describe("门审批卡片(作者验收)", () => {
  it("gates 命令注册且出结构化卡片标记", () => {
    expect(cmdSrc).toContain("\"gates\"");
    expect(cmdSrc).toContain("data-gate-card");
    expect(cmdSrc.includes("没有待审门") || cmdSrc.includes("\\u6CA1\\u6709\\u5F85\\u5BA1\\u95E8")).toBe(true);
  });
  it("client 渲染卡片并接真实端点", () => {
    expect(clientSrc).toContain("data-gate-card");
    expect(clientSrc).toContain("/api/merge");
    expect(clientSrc).toContain("/api/gates/discard");
  });
  it("结果态与处理中态在位", () => {
    expect(clientSrc.includes("已合并") || clientSrc.includes("\\u5DF2\\u5408\\u5E76")).toBe(true);
    expect(clientSrc.includes("已驳回") || clientSrc.includes("\\u5DF2\\u9A73\\u56DE")).toBe(true);
    expect(clientSrc.includes("处理中") || clientSrc.includes("\\u5904\\u7406\\u4E2D")).toBe(true);
  });
});