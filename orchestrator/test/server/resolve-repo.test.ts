import { describe, it, expect } from "vitest";
import { registeredProjects, resolveRepo } from "../../src/server/project-scope.js";

describe("resolveRepo/registeredProjects 析出", () => {
  it("registeredProjects 单仓模式：id=basename、repoPath=repoRoot", async () => {
    const list = await registeredProjects({ repoRoot: "/tmp/x" });
    expect(list).toHaveLength(1);
    expect(list[0].repoPath).toBe("/tmp/x");
    expect(list[0].id).toBe("x");
  });

  it("resolveRepo 单仓模式恒返回 repoRoot", async () => {
    expect(await resolveRepo({ repoRoot: "/tmp/x" }, "any")).toBe("/tmp/x");
    expect(await resolveRepo({ repoRoot: "/tmp/x" }, "")).toBe("/tmp/x");
  });
});