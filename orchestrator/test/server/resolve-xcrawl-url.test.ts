import { describe, expect, it } from "vitest";
import { resolveXcrawlMcpUrl } from "../../src/server/resolve-xcrawl-url.js";

describe("resolveXcrawlMcpUrl", () => {
  it("returns xcrawl url from a valid Claude config", () => {
    const url = "https://mcp.xcrawl.com/xc-abc/mcp";
    const readFile = () => JSON.stringify({ mcpServers: { xcrawl: { url } } });

    expect(resolveXcrawlMcpUrl("/fake/.claude.json", readFile)).toBe(url);
  });

  it("returns undefined when xcrawl server is missing", () => {
    const readFile = () => JSON.stringify({ mcpServers: { other: { url: "x" } } });

    expect(resolveXcrawlMcpUrl("/fake/.claude.json", readFile)).toBeUndefined();
  });

  it("returns undefined when mcpServers is missing", () => {
    const readFile = () => JSON.stringify({});

    expect(resolveXcrawlMcpUrl("/fake/.claude.json", readFile)).toBeUndefined();
  });

  it("returns undefined when url is not a string", () => {
    const readFile = () => JSON.stringify({ mcpServers: { xcrawl: { url: 123 } } });

    expect(resolveXcrawlMcpUrl("/fake/.claude.json", readFile)).toBeUndefined();
  });

  it("returns undefined when reading the file throws", () => {
    const readFile = (): string => {
      throw new Error("missing file");
    };

    expect(() => resolveXcrawlMcpUrl("/fake/.claude.json", readFile)).not.toThrow();
    expect(resolveXcrawlMcpUrl("/fake/.claude.json", readFile)).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    const readFile = () => "not json";

    expect(resolveXcrawlMcpUrl("/fake/.claude.json", readFile)).toBeUndefined();
  });
});
