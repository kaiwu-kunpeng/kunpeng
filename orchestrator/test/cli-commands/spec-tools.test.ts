import { describe, it, expect } from "vitest";
import "../../src/cli-commands/spec-tools.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";

describe("spec/图谱工具命令组析出到 CLI 注册表", () => {
  it("注册了 codegraph/spec-lint/ai-repo-kit/spec-delta/release", () => {
    const names = listCliCommands().map((c) => c.name);
    for (const name of ["codegraph", "spec-lint", "ai-repo-kit", "spec-delta", "release"]) {
      expect(names).toContain(name);
    }
  });
});