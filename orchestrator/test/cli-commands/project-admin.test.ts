import { describe, it, expect } from "vitest";
import "../../src/cli-commands/project-admin.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";

describe("注册/项目管理命令组析出到 CLI 注册表", () => {
  it("注册了 register/projects/auth/onboard/workspace/backend/snapshot/gc", () => {
    const names = listCliCommands().map((c) => c.name);
    for (const name of ["register", "projects", "auth", "onboard", "workspace", "backend", "snapshot", "gc"]) {
      expect(names).toContain(name);
    }
  });
});