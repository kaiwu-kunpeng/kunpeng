import { describe, it, expect } from "vitest";
import { gatherCrossProjectExperiences, type ExperienceLister } from "../src/loop/cross-project-experience.js";
import type { Artifact } from "../src/artifacts/types.js";

function exp(id: string): Artifact {
  return { kind: "experience", id, status: "draft", body: `body-${id}`, meta: {} } as unknown as Artifact;
}

function listerWith(...ids: string[]): ExperienceLister {
  return { list: async () => ids.map(exp) };
}

const throwingLister: ExperienceLister = { list: async () => { throw new Error("boom: dir missing"); } };

describe("gatherCrossProjectExperiences", () => {
  it("聚合所有非本仓项目的经验，排除本仓", async () => {
    const stores: Record<string, ExperienceLister> = {
      "/p1/.kunpeng/artifacts": listerWith("e1", "e2"),
      "/self/.kunpeng/artifacts": listerWith("eSELF"),
      "/p2/.kunpeng/artifacts": listerWith("e3"),
    };
    const res = await gatherCrossProjectExperiences(
      [{ id: "p1", repoPath: "/p1" }, { id: "self", repoPath: "/self" }, { id: "p2", repoPath: "/p2" }],
      "/self",
      (dir) => stores[dir],
    );
    const ids = res.map((a) => a.id);
    expect(ids).toEqual(["e1", "e2", "e3"]);
    expect(ids).not.toContain("eSELF");
  });

  it("单个坏项目不中断其余项目", async () => {
    const stores: Record<string, ExperienceLister> = {
      "/bad/.kunpeng/artifacts": throwingLister,
      "/good/.kunpeng/artifacts": listerWith("g1"),
    };
    const res = await gatherCrossProjectExperiences(
      [{ id: "bad", repoPath: "/bad" }, { id: "good", repoPath: "/good" }],
      "/self",
      (dir) => stores[dir],
    );
    expect(res.map((a) => a.id)).toEqual(["g1"]);
  });

  it("跨项目按 id 去重，先到先留", async () => {
    const stores: Record<string, ExperienceLister> = {
      "/a/.kunpeng/artifacts": listerWith("dup", "x"),
      "/b/.kunpeng/artifacts": listerWith("dup", "y"),
    };
    const res = await gatherCrossProjectExperiences(
      [{ id: "a", repoPath: "/a" }, { id: "b", repoPath: "/b" }],
      "/self",
      (dir) => stores[dir],
    );
    expect(res.map((a) => a.id)).toEqual(["dup", "x", "y"]);
  });
});
