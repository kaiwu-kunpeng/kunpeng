import { describe, it, expect } from "vitest";
import "../../src/cli-commands/knowledge.js";
import { dispatchCliCommand, listCliCommands, type CliContext } from "../../src/cli-commands/registry.js";

function contextOf(): CliContext {
  return { repoRoot: process.cwd(), kunpengHome: process.cwd(), rest: [], argv: [], flags: new Set<string>() };
}

describe("knowledge 命令组析出到 CLI 注册表", () => {
  it("注册了 capture/kb/recall/promote", () => {
    const names = listCliCommands().map((c) => c.name);
    for (const name of ["capture", "kb", "recall", "promote"]) {
      expect(names).toContain(name);
    }
  });

  it("dispatch 未注册命令返回 false,不吞已注册命令", async () => {
    expect(await dispatchCliCommand("__no_such_command__", contextOf())).toBe(false);
    expect(listCliCommands().some((c) => c.name === "recall")).toBe(true);
  });
});