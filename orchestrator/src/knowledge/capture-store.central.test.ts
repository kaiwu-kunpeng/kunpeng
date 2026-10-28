import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveCapturesDir } from "./capture-store.js";

function gitInit(dir: string, remote?: string): void {
  execFileSync("git", ["init", "-q", dir]);
  if (remote) execFileSync("git", ["-C", dir, "remote", "add", "origin", remote]);
}

describe("captures 中央目录解析(库外迁移)", () => {
  afterEach(() => {
    delete process.env.KUNPENG_CAPTURES_ROOT;
  });

  it("同一 remote 的两棵树解析到同一中央目录", () => {
    const root = mkdtempSync(join(tmpdir(), "kp-cap-"));
    process.env.KUNPENG_CAPTURES_ROOT = join(root, "central");
    const a = join(root, "tree-a");
    const b = join(root, "tree-b");
    mkdirSync(a);
    mkdirSync(b);
    gitInit(a, "https://example.com/org/proj.git");
    gitInit(b, "https://example.com/org/proj.git");
    expect(resolveCapturesDir(a)).toBe(resolveCapturesDir(b));
    expect(resolveCapturesDir(a).startsWith(join(root, "central"))).toBe(true);
  });

  it("无 remote 时按路径分键,不同路径不同目录", () => {
    const root = mkdtempSync(join(tmpdir(), "kp-cap-"));
    process.env.KUNPENG_CAPTURES_ROOT = join(root, "central");
    const a = join(root, "solo-a");
    const b = join(root, "solo-b");
    mkdirSync(a);
    mkdirSync(b);
    gitInit(a);
    gitInit(b);
    expect(resolveCapturesDir(a)).not.toBe(resolveCapturesDir(b));
  });

  it("旧仓内目录自动搬迁到中央目录", () => {
    const root = mkdtempSync(join(tmpdir(), "kp-cap-"));
    process.env.KUNPENG_CAPTURES_ROOT = join(root, "central");
    const repo = join(root, "repo");
    mkdirSync(repo);
    gitInit(repo, "https://example.com/org/legacy.git");
    const legacy = join(repo, ".kunpeng", "captures");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "cap-x.json"), JSON.stringify({ id: "cap-x" }));
    const central = resolveCapturesDir(repo);
    expect(readdirSync(central)).toContain("cap-x.json");
  });
});