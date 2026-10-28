import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMcpServers, registerMcpServer, removeMcpServer, setMcpEnabled, buildMcpBaseConfig } from "../../src/mcp/registry.js";

describe("P1:MCP 注册表", () => {
  it("增删改查全链路(空库起步)", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-mcp-"));
    expect(await listMcpServers(root)).toEqual([]);
    await registerMcpServer(root, { id: "codegraph", transport: "stdio", command: "node", args: ["x.js"], enabled: true });
    await registerMcpServer(root, { id: "remote", transport: "http", url: "https://mcp.example.com", enabled: false });
    const all = await listMcpServers(root);
    expect(all.map((e) => e.id).sort()).toEqual(["codegraph", "remote"]);
    await setMcpEnabled(root, "remote", true);
    expect((await listMcpServers(root)).find((e) => e.id === "remote")?.enabled).toBe(true);
    await removeMcpServer(root, "codegraph");
    expect((await listMcpServers(root)).map((e) => e.id)).toEqual(["remote"]);
  });

  it("覆盖注册/未知 id 报错/非法条目报错", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-mcp2-"));
    await registerMcpServer(root, { id: "a", transport: "stdio", command: "x", enabled: true });
    await registerMcpServer(root, { id: "a", transport: "stdio", command: "y", enabled: true });
    const all = await listMcpServers(root);
    expect(all.length).toBe(1);
    expect(all[0]?.command).toBe("y");
    await expect(setMcpEnabled(root, "不存在", true)).rejects.toThrow(/不存在/);
    await expect(removeMcpServer(root, "ghost")).rejects.toThrow(/ghost/);
    await expect(registerMcpServer(root, { id: "bad id", transport: "stdio", command: "x", enabled: true })).rejects.toThrow();
    await expect(registerMcpServer(root, { id: "nohttp", transport: "http", enabled: true })).rejects.toThrow();
  });

  it("坏档硬报错不静默", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-mcp3-"));
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "index.json"), "{坏json", "utf8");
    await expect(listMcpServers(root)).rejects.toThrow();
  });

  it("buildMcpBaseConfig 只吐 enabled 且形态兼容 mcp-generator", () => {
    const cfg = buildMcpBaseConfig([
      { id: "on", transport: "stdio", command: "node", args: ["a.js"], env: { TOKEN: "${MY_TOKEN}" }, enabled: true },
      { id: "off", transport: "stdio", command: "node", enabled: false },
      { id: "web", transport: "http", url: "https://x", headers: { Authorization: "${AUTH}" }, enabled: true },
    ]);
    expect(Object.keys(cfg.mcpServers).sort()).toEqual(["on", "web"]);
    expect(cfg.mcpServers.on?.command).toBe("node");
    expect(cfg.mcpServers.on?.env?.TOKEN).toBe("${MY_TOKEN}");
    expect(cfg.mcpServers.web?.url).toBe("https://x");
    expect(cfg.mcpServers.off).toBeUndefined();
  });
});