import { describe, it, expect } from "vitest";
import "../../src/cli-commands/library-skills.js";
import "../../src/cli-commands/knowledge.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";

describe("library/skills 命令组析出到 CLI 注册表", () => {
  it("注册了 lib/lessons/distill-skill/skill,且不覆盖 step1 命令", () => {
    const names = listCliCommands().map((c) => c.name);
    for (const name of ["lib", "lessons", "distill-skill", "skill", "capture", "kb", "recall", "promote"]) {
      expect(names).toContain(name);
    }
  });
});