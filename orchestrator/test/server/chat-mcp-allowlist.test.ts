import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatMcpAllowlist, readGlobalMcpServers, mergeAllowedMcpServers } from "../../src/server/localfs/chat-wiring.js";

describe("chatMcpAllowlist", () => {
  it("默认仅 xcrawl", () => {
    expect(chatMcpAllowlist({} as NodeJS.ProcessEnv)).toEqual(["xcrawl"]);
    expect(chatMcpAllowlist({ KP_CHAT_MCP: "  " } as NodeJS.ProcessEnv)).toEqual(["xcrawl"]);
  });
  it("env 逗号分隔覆盖,trim 去空", () => {
    expect(chatMcpAllowlist({ KP_CHAT_MCP: "xcrawl, tavily ,, github" } as NodeJS.ProcessEnv)).toEqual(["xcrawl", "tavily", "github"]);
  });
});

describe("readGlobalMcpServers", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-mcp-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  it("读出 mcpServers 对象", () => {
    const p = join(dir, ".claude.json");
    writeFileSync(p, JSON.stringify({ mcpServers: { xcrawl: { command: "npx", args: ["xcrawl-mcp"] }, github: { command: "gh" } } }));
    expect(Object.keys(readGlobalMcpServers(p))).toEqual(["xcrawl", "github"]);
  });
  it("缺文件/坏 JSON → {}", () => {
    expect(readGlobalMcpServers(join(dir, "nope.json"))).toEqual({});
    const bad = join(dir, "bad.json"); writeFileSync(bad, "not json{");
    expect(readGlobalMcpServers(bad)).toEqual({});
  });
});

describe("mergeAllowedMcpServers", () => {
  const base = { mcpServers: { localfs: { command: "node" } } };
  const global = { xcrawl: { command: "npx", args: ["xcrawl-mcp"] }, github: { command: "gh" }, neon: { command: "neon" } };
  it("localfs 恒保留 + 只挂 allowlist 命中的", () => {
    const m = mergeAllowedMcpServers(base, global, ["xcrawl"]);
    expect(Object.keys(m.mcpServers).sort()).toEqual(["localfs", "xcrawl"]);
    expect(m.mcpServers.xcrawl).toEqual(global.xcrawl);
  });
  it("allowlist 里全局没有的忽略,不炸", () => {
    const m = mergeAllowedMcpServers(base, global, ["xcrawl", "不存在的"]);
    expect(Object.keys(m.mcpServers).sort()).toEqual(["localfs", "xcrawl"]);
  });
  it("多个命中都挂;不改入参", () => {
    const m = mergeAllowedMcpServers(base, global, ["xcrawl", "neon"]);
    expect(Object.keys(m.mcpServers).sort()).toEqual(["localfs", "neon", "xcrawl"]);
    expect(Object.keys(base.mcpServers)).toEqual(["localfs"]);
  });
});