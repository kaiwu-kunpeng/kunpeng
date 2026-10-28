import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../src/cli-commands/mcp.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { syncMcpBase } from "../../src/cli-commands/mcp.js";
import { registerMcpServer } from "../../src/mcp/registry.js";

describe("P2:kunpeng mcp 命令组", () => {
  it("mcp 命令已注册", () => {
    expect(listCliCommands().some((c) => c.name === "mcp")).toBe(true);
  });

  it("syncMcpBase 只把 enabled 条目写成 mcp-base.json", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-mcp-cli-"));
    const shared = join(mkdtempSync(join(tmpdir(), "kp-shared-")), "mcp-base.json");
    await registerMcpServer(root, { id: "on", transport: "stdio", command: "node", args: ["a.js"], enabled: true });
    await registerMcpServer(root, { id: "off", transport: "stdio", command: "node", enabled: false });
    const r = await syncMcpBase(root, shared);
    expect(r.path).toBe(shared);
    expect(r.count).toBe(1);
    const cfg = JSON.parse(readFileSync(shared, "utf8")) as { mcpServers: Record<string, { command?: string }> };
    expect(Object.keys(cfg.mcpServers)).toEqual(["on"]);
    expect(cfg.mcpServers.on?.command).toBe("node");
  });
});