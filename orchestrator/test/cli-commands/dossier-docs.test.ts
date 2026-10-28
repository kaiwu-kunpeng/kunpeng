import { describe, it, expect } from "vitest";
import "../../src/cli-commands/dossier-docs.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";

describe("dossier/docs 命令组析出到 CLI 注册表", () => {
  it("注册了 dossier/spec-index/adr/changelog/bump/compile/asset-bundle/doc", () => {
    const names = listCliCommands().map((c) => c.name);
    for (const name of ["dossier", "spec-index", "adr", "changelog", "bump", "compile", "asset-bundle", "doc"]) {
      expect(names).toContain(name);
    }
  });
});