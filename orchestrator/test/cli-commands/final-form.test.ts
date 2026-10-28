import { describe, it, expect } from "vitest";
import "../../src/cli.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { usageText } from "../../src/cli.js";
import { cliEntrySource } from "../helpers/cli-source.js";

describe("cli.ts 入口终态守门(拆解不回潮)", () => {
  it("cli.ts 无内联命令分支、≤200 行、走统一 dispatch", () => {
    const src = cliEntrySource();
    expect(src.includes("if (cmd === ")).toBe(false);
    expect(src.split("\n").length).toBeLessThanOrEqual(200);
    expect(src).toContain("dispatchCliCommand");
  });

  it("usageText 列出的每个命令都已在注册表注册(防漂移)", () => {
    const usage = usageText().replace(/^命令:\s*/, "").split("|").map((s) => s.trim()).filter(Boolean);
    const names = new Set(listCliCommands().map((c) => c.name));
    const missing = usage.filter((u) => !names.has(u));
    expect(usage.length).toBeGreaterThanOrEqual(60);
    expect(missing).toEqual([]);
  });
});