import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { profileProjects, gateProjects } from "../../src/server/project-scope.js";

describe("project-scope 析出", () => {
  it("profileProjects 读 <stateDir>/profiles/<id>/projects.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-projscope-"));
    const pdir = join(dir, "profiles", "p1");
    mkdirSync(pdir, { recursive: true });
    writeFileSync(join(pdir, "projects.json"), JSON.stringify({ projects: [{ id: "a", name: "A", repoPath: "/repo/a", registeredAt: 1 }] }));
    const list = profileProjects("p1", dir);
    expect(list.map((p) => p.repoPath)).toContain("/repo/a");
  });

  it("gateProjects 单仓模式返回 [repoRoot]", async () => {
    expect(await gateProjects({ repoRoot: "/x" })).toEqual(["/x"]);
  });
});