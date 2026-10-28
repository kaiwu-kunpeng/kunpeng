import { describe, expect, it } from "vitest";
import { pickDossierRepoPath } from "../../src/server/view-state.js";

describe("pickDossierRepoPath", () => {
  it("kunpeng 不在首位时仍优先选它(本次修复的核心)", () => {
    const snaps = [
      { id: "proj-alpha", repoPath: "/repos/alpha" },
      { id: "proj-beta", repoPath: "/repos/beta" },
      { id: "kunpeng", repoPath: "/repos/kunpeng" },
    ];
    expect(pickDossierRepoPath(snaps)).toBe("/repos/kunpeng");
  });

  it("kunpeng 在首位时也正常返回", () => {
    const snaps = [
      { id: "kunpeng", repoPath: "/repos/kunpeng" },
      { id: "proj-beta", repoPath: "/repos/beta" },
    ];
    expect(pickDossierRepoPath(snaps)).toBe("/repos/kunpeng");
  });

  it("没有 kunpeng 时退回第一个有 repoPath 的项目", () => {
    const snaps = [
      { id: "proj-alpha", repoPath: "/repos/alpha" },
      { id: "proj-beta", repoPath: "/repos/beta" },
    ];
    expect(pickDossierRepoPath(snaps)).toBe("/repos/alpha");
  });

  it("kunpeng 存在但没有 repoPath → 退回第一个有 repoPath 的", () => {
    const snaps = [
      { id: "proj-beta", repoPath: "/repos/beta" },
      { id: "kunpeng" },
    ];
    expect(pickDossierRepoPath(snaps)).toBe("/repos/beta");
  });

  it("空数组 / 全缺 repoPath / 空串 → undefined,且不抛错", () => {
    expect(pickDossierRepoPath([])).toBeUndefined();
    expect(pickDossierRepoPath([{ id: "a" }, { id: "b" }])).toBeUndefined();
    expect(pickDossierRepoPath([{ id: "kunpeng", repoPath: "" }])).toBeUndefined();
    expect(pickDossierRepoPath([{ id: "kunpeng", repoPath: "   " }])).toBeUndefined();
  });

  it("数组里混入 undefined 元素也安全", () => {
    const snaps = [undefined, { id: "kunpeng", repoPath: "/repos/kunpeng" }] as unknown as { id?: string; repoPath?: string }[];
    expect(pickDossierRepoPath(snaps)).toBe("/repos/kunpeng");
  });
});