import { describe, it, expect } from "vitest";
import { BUILTIN_MCP_SERVERS, mergeAllowedMcpServers } from "../../src/server/localfs/chat-wiring.js";

const base = { mcpServers: { localfs: { command: "node" } } };

describe("内置无 key MCP", () => {
  it("BUILTIN 含 fetch/memory/sequential-thinking/time 且无 key(env字段)", () => {
    for (const name of ["fetch", "memory", "sequential-thinking", "time"]) {
      expect(name in BUILTIN_MCP_SERVERS).toBe(true);
    }
    // 内置定义只有 command/args,不含带凭证的 env
    for (const def of Object.values(BUILTIN_MCP_SERVERS)) {
      expect(Object.keys(def).sort()).toEqual(["args", "command"]);
    }
  });

  it("allowlist 里的内置 name(全局没有)从内置挂上", () => {
    const m = mergeAllowedMcpServers(base, {}, ["fetch", "memory"]);
    expect(Object.keys(m.mcpServers).sort()).toEqual(["fetch", "localfs", "memory"]);
    expect(m.mcpServers.fetch).toEqual(BUILTIN_MCP_SERVERS.fetch);
  });

  it("全局定义优先于内置(同名用全局)", () => {
    const custom = { fetch: { command: "my-fetch", args: [] } };
    const m = mergeAllowedMcpServers(base, custom, ["fetch"]);
    expect(m.mcpServers.fetch).toEqual(custom.fetch);
  });

  it("既非全局也非内置的 name 忽略;localfs 恒保留", () => {
    const m = mergeAllowedMcpServers(base, {}, ["不存在", "fetch"]);
    expect(Object.keys(m.mcpServers).sort()).toEqual(["fetch", "localfs"]);
  });
});