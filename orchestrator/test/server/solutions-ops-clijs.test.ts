import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server", "routes", "solutions-ops.ts"),
  "utf8",
);

describe("solutions-ops cliJs fallback 深度", () => {
  it("compiled 路径上跳两层到 dist 根", () => {
    expect(src).toContain('join(here, "..", "..", "cli.js")');
    expect(src).not.toContain('join(here, "..", "cli.js")');
  });
  it("source 路径上跳三层到 orchestrator/dist", () => {
    expect(src).toContain('join(here, "..", "..", "..", "dist", "cli.js")');
  });
});