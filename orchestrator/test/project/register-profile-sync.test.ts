import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProject } from "../../src/project/registry.js";
import { readProfileRegistry, writeProfileRegistry } from "../../src/project/registry-profile.js";

const NOW = 1_800_000_000_000;
let stateDir: string;
let repo: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "kp-reg-state-"));
  repo = mkdtempSync(join(tmpdir(), "kp-reg-repo-"));
});
afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("registerProject 同步 profile 项目表", () => {
  it("已存在的每个 profile 都能查到新项目", async () => {
    const homePath = join(stateDir, "profiles", "home", "projects.json");
    const workPath = join(stateDir, "profiles", "work", "projects.json");
    writeProfileRegistry(homePath, [{ id: "kunpeng", name: "kunpeng", repoPath: "/x", registeredAt: 1 }]);
    writeProfileRegistry(workPath, []);
    const entry = await registerProject({ repoPath: repo, stateDir, now: NOW });
    for (const p of [homePath, workPath]) {
      const projects = readProfileRegistry(p);
      expect(projects.some((x) => x.id === entry.id && x.repoPath === repo)).toBe(true);
    }
    expect(readProfileRegistry(homePath).some((x) => x.id === "kunpeng")).toBe(true);
  });
  it("重复注册同 id 是更新不是重复条目", async () => {
    const homePath = join(stateDir, "profiles", "home", "projects.json");
    writeProfileRegistry(homePath, []);
    await registerProject({ repoPath: repo, stateDir, now: NOW });
    await registerProject({ repoPath: repo, stateDir, now: NOW + 1 });
    const projects = readProfileRegistry(homePath);
    expect(projects.filter((x) => x.repoPath === repo)).toHaveLength(1);
  });
  it("无 profiles 目录时注册照常成功", async () => {
    const entry = await registerProject({ repoPath: repo, stateDir, now: NOW });
    expect(entry.id.length).toBeGreaterThan(0);
  });
  it("profiles 下有空目录（无 projects.json）不炸且被建表", async () => {
    mkdirSync(join(stateDir, "profiles", "fresh"), { recursive: true });
    const entry = await registerProject({ repoPath: repo, stateDir, now: NOW });
    const projects = readProfileRegistry(join(stateDir, "profiles", "fresh", "projects.json"));
    expect(projects.some((x) => x.id === entry.id)).toBe(true);
  });
});