import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const base = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "server");
const clientSrc = clientSource();
const typesSrc = readFileSync(join(base, "localfs", "types.ts"), "utf8");
const mcpSrc = readFileSync(join(base, "localfs", "mcp-server.ts"), "utf8");
const queueSrc = readFileSync(join(base, "localfs", "op-queue.ts"), "utf8");

describe("localfs v2(作者验收)", () => {
  it("types 扩展 encoding/truncated", () => {
    expect(typesSrc).toContain('"base64"');
    expect(typesSrc).toContain("truncated");
  });
  it("client 二进制判定+上限+错误分类", () => {
    expect(clientSrc).toContain("base64");
    expect(clientSrc.includes("NotFoundError")).toBe(true);
    expect(clientSrc.includes("NotAllowedError")).toBe(true);
    expect(clientSrc.includes("路径不存在") || clientSrc.includes("\\u8DEF\\u5F84\\u4E0D\\u5B58\\u5728")).toBe(true);
    expect(clientSrc.includes("重新授权") || clientSrc.includes("\\u91CD\\u65B0\\u6388\\u6743")).toBe(true);
    expect(/2\s*\*\s*1024\s*\*\s*1024|2097152/.test(clientSrc)).toBe(true);
    expect(/5\s*\*\s*1024\s*\*\s*1024|5242880/.test(clientSrc)).toBe(true);
  });
  it("mcp-server 工具描述与 base64 包装", () => {
    expect(mcpSrc).toContain("base64");
  });
  it("op-queue 超时话术可排障", () => {
    expect(queueSrc.includes("浏览器") || queueSrc.includes("chip") || queueSrc.includes("cockpit")).toBe(true);
  });
});