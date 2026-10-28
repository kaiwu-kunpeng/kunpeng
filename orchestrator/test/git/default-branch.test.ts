import { describe, it, expect } from "vitest";
import { parseSymbolicRefBranch, resolveDefaultBranch } from "../../src/git/default-branch.js";

describe("parseSymbolicRefBranch", () => {
  it("从 origin/HEAD 符号引用取分支名", () => {
    expect(parseSymbolicRefBranch("refs/remotes/origin/main\n")).toBe("main");
    expect(parseSymbolicRefBranch("refs/remotes/origin/master")).toBe("master");
  });
  it("非法/空 → null", () => {
    expect(parseSymbolicRefBranch("")).toBeNull();
    expect(parseSymbolicRefBranch("garbage")).toBeNull();
  });
});

describe("resolveDefaultBranch", () => {
  it("symbolicRef 成功 → 解析出的分支", async () => {
    const got = await resolveDefaultBranch({ symbolicRef: async () => "refs/remotes/origin/main\n", fallback: "work" });
    expect(got).toBe("main");
  });
  it("symbolicRef 抛错 → 回退 fallback", async () => {
    const got = await resolveDefaultBranch({ symbolicRef: async () => { throw new Error("no origin/HEAD"); }, fallback: "work" });
    expect(got).toBe("work");
  });
  it("symbolicRef 返回无法解析 → 回退 fallback", async () => {
    const got = await resolveDefaultBranch({ symbolicRef: async () => "garbage", fallback: "work" });
    expect(got).toBe("work");
  });
});