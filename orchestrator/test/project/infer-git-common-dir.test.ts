import { describe, it, expect } from "vitest";
import { inferProjectFromPath } from "../../src/project/infer.js";

const REGISTRY = [{ id: "kunpeng", name: "kunpeng", repoPath: "/repo/kunpeng" }];

describe("兄弟 worktree 经 git common-dir 归一识别", () => {
  it("平级兄弟目录能识别出项目", () => {
    const got = inferProjectFromPath("/repo/kunpeng-serve", {
      readSelf: () => null,
      registryEntries: () => REGISTRY,
      gitCommonRoot: () => "/repo/kunpeng",
    });
    expect(got?.id).toBe("kunpeng");
    expect(got?.repoPath).toBe("/repo/kunpeng");
  });

  it("前两条命中时不调用 gitCommonRoot", () => {
    let calls = 0;
    const got = inferProjectFromPath("/repo/kunpeng/sub/dir", {
      readSelf: () => null,
      registryEntries: () => REGISTRY,
      gitCommonRoot: () => { calls += 1; return "/repo/kunpeng"; },
    });
    expect(got?.id).toBe("kunpeng");
    expect(calls).toBe(0);
  });

  it("project.json 命中时也不调用 gitCommonRoot", () => {
    let calls = 0;
    const got = inferProjectFromPath("/anywhere/proj", {
      readSelf: (dir) => (dir === "/anywhere/proj" ? { id: "other" } : null),
      registryEntries: () => REGISTRY,
      gitCommonRoot: () => { calls += 1; return "/repo/kunpeng"; },
    });
    expect(got?.id).toBe("other");
    expect(calls).toBe(0);
  });

  it("gitCommonRoot 返回 null 时维持原行为", () => {
    const got = inferProjectFromPath("/somewhere/else", {
      readSelf: () => null,
      registryEntries: () => REGISTRY,
      gitCommonRoot: () => null,
    });
    expect(got).toBeNull();
  });

  it("gitCommonRoot 抛错也不崩", () => {
    expect(() =>
      inferProjectFromPath("/somewhere/else", {
        readSelf: () => null,
        registryEntries: () => REGISTRY,
        gitCommonRoot: () => { throw new Error("git 不可用"); },
      }),
    ).not.toThrow();
  });

  it("主仓自身路径识别不变", () => {
    const got = inferProjectFromPath("/repo/kunpeng", {
      readSelf: () => null,
      registryEntries: () => REGISTRY,
      gitCommonRoot: () => "/repo/kunpeng",
    });
    expect(got?.id).toBe("kunpeng");
  });
});