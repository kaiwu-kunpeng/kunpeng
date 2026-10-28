import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexMcpArgs } from "../../src/agent/codex-mcp-args.js";
import { getAdapter } from "../../src/agent/backend-adapter.js";

function writeCfg(cfg: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "kp-codex-mcp-"));
  const p = join(dir, "mcp.json");
  writeFileSync(p, JSON.stringify(cfg), "utf8");
  return p;
}

describe("X1:codexMcpArgs", () => {
  it("空路径/缺文件/坏 JSON 一律空数组", () => {
    expect(codexMcpArgs(undefined)).toEqual([]);
    expect(codexMcpArgs("/不存在/mcp.json")).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), "kp-codex-bad-"));
    const bad = join(dir, "mcp.json");
    writeFileSync(bad, "{坏", "utf8");
    expect(codexMcpArgs(bad)).toEqual([]);
  });

  it("stdio server 展开为 -c 三元组", () => {
    const p = writeCfg({ mcpServers: { demo: { command: "node", args: ["x.js", "--flag"], env: { FOO: "bar" } } } });
    const args = codexMcpArgs(p);
    expect(args.filter((a) => a === "-c").length).toBe(3);
    expect(args).toContain('mcp_servers.demo.command="node"');
    expect(args).toContain('mcp_servers.demo.args=["x.js","--flag"]');
    expect(args).toContain('mcp_servers.demo.env={FOO="bar"}');
  });

  it("url server 展开 url+http_headers;非法名跳过", () => {
    const p = writeCfg({ mcpServers: { web: { url: "https://x", headers: { Authorization: "${AUTH}" } }, "bad name": { command: "x" } } });
    const args = codexMcpArgs(p);
    expect(args).toContain('mcp_servers.web.url="https://x"');
    expect(args).toContain('mcp_servers.web.http_headers={Authorization="${AUTH}"}');
    expect(args.join(" ").includes("bad name")).toBe(false);
  });

  it("codex adapter 的 invoke 与 invokeStream 都注入 mcp 参数", () => {
    const p = writeCfg({ mcpServers: { demo: { command: "node" } } });
    const adapter = getAdapter("codex");
    expect(adapter).toBeTruthy();
    const inv = adapter!.invoke({} as never, [], p);
    expect(inv.args).toContain('mcp_servers.demo.command="node"');
    const invStream = adapter!.invokeStream ? adapter!.invokeStream({} as never, [], p) : inv;
    expect(invStream.args).toContain('mcp_servers.demo.command="node"');
  });
});