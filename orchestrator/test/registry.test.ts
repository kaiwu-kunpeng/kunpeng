import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugify, registerProject, readRegistry, readProjectSelf } from "../src/project/registry.js";

// repo 目录名固定为 "demo-travel"，以便断言 id（id 来自目录名而非 name）。
let state: string, parent: string, repo: string;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "kp-state-"));
  parent = mkdtempSync(join(tmpdir(), "kp-parent-"));
  repo = join(parent, "demo-travel");
  mkdirSync(repo);
});
afterEach(() => { rmSync(state, { recursive: true, force: true }); rmSync(parent, { recursive: true, force: true }); });

test("slugify lowercases and dashes non-alnum", () => {
  expect(slugify("DemoTravel.ai")).toBe("demotravel-ai");
  expect(slugify("  ")).toBe("project");
});

test("registerProject id 来自目录名、name 保留中文（中文友好）", async () => {
  const e = await registerProject({ repoPath: repo, name: "外国人来华办事台", stateDir: state, now: 111 });
  expect(e.id).toBe("demo-travel");       // id 不随中文 name 塌成空
  expect(e.name).toBe("外国人来华办事台");   // 展示名保留中文
  expect(e.repoPath).toBe(repo);
  const reg = await readRegistry(state);
  expect(reg).toHaveLength(1);
  expect(reg[0].name).toBe("外国人来华办事台");
  const self = await readProjectSelf(repo);
  expect(self?.id).toBe("demo-travel");
  expect(self?.registeredAt).toBe(111);
});

test("registerProject is idempotent by id (updates, no duplicate)", async () => {
  await registerProject({ repoPath: repo, name: "X", stateDir: state, now: 1 });
  await registerProject({ repoPath: repo, name: "X", stateDir: state, now: 2 });
  const reg = await readRegistry(state);
  expect(reg).toHaveLength(1);
  expect(reg[0].registeredAt).toBe(2);
});

test("registerProject defaults name to repo basename", async () => {
  const e = await registerProject({ repoPath: repo, stateDir: state, now: 1 });
  expect(e.name).toBe("demo-travel");
});

test("readRegistry returns [] when registry missing", async () => {
  expect(await readRegistry(join(state, "nope"))).toEqual([]);
  expect(existsSync(join(state, "nope"))).toBe(false);
});

test("readRegistry filters out malformed entries (missing fields)", async () => {
  writeFileSync(join(state, "projects.json"), '{"projects":[{"id":"x"}]}', "utf8");
  expect(await readRegistry(state)).toEqual([]);
});

test("readRegistry returns [] on non-JSON garbage", async () => {
  writeFileSync(join(state, "projects.json"), "not json", "utf8");
  expect(await readRegistry(state)).toEqual([]);
});

test("readProjectSelf returns null when self-desc missing fields", async () => {
  const selfDir = join(repo, ".kunpeng");
  mkdirSync(selfDir, { recursive: true });
  writeFileSync(join(selfDir, "project.json"), "{}", "utf8");
  expect(await readProjectSelf(repo)).toBeNull();
});
