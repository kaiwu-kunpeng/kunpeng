import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cliSource } from "./cli-source.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("cliSource helper", () => {
  it("包含 cli.ts 全部源码(cli-commands 模块拼接为超集)", () => {
    const raw = readFileSync(join(here, "..", "..", "src", "cli.ts"), "utf8");
    const combined = cliSource();
    expect(combined.startsWith(raw)).toBe(true);
    expect(combined).toContain("recursionGuardReason");
    expect(combined).toContain("usageText");
  });
});