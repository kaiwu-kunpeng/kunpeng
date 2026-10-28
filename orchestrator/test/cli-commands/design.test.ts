import { describe, it, expect } from "vitest";
import "../../src/cli-commands/design.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";

describe("design 命令组析出到 CLI 注册表", () => {
  it("注册了 design/design-memory/design-loop/design-preview/design-codegen", () => {
    const names = listCliCommands().map((c) => c.name);
    for (const name of ["design", "design-memory", "design-loop", "design-preview", "design-codegen"]) {
      expect(names).toContain(name);
    }
  });
});