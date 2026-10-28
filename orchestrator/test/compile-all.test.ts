import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAll } from "../src/compile/compile-all.js";

let kunpengRoot: string;
let proj1: string;
let proj2: string;

beforeEach(async () => {
  kunpengRoot = await mkdtemp(join(tmpdir(), "kp-root-"));
  await mkdir(join(kunpengRoot, "constitution"), { recursive: true });
  await mkdir(join(kunpengRoot, "roster"), { recursive: true });
  await writeFile(join(kunpengRoot, "constitution", "core.md"), "CORE-RULES-XYZ");
  await writeFile(join(kunpengRoot, "constitution", "conventions.md"), "CONV-RULES-XYZ");
  await writeFile(join(kunpengRoot, "roster", "a.role.md"), "ROLE-A");
  proj1 = await mkdtemp(join(tmpdir(), "kp-p1-"));
  proj2 = await mkdtemp(join(tmpdir(), "kp-p2-"));
});

afterEach(async () => {
  for (const d of [kunpengRoot, proj1, proj2]) await rm(d, { recursive: true, force: true });
});

describe("compileAll", () => {
  it("把宪法编译进每个项目的 AGENTS.md，顺序与输入一致", async () => {
    const res = await compileAll(kunpengRoot, [
      { id: "p1", repoPath: proj1 },
      { id: "p2", repoPath: proj2 },
    ]);
    expect(res.map((r) => r.id)).toEqual(["p1", "p2"]);
    for (const proj of [proj1, proj2]) {
      const agents = await readFile(join(proj, "AGENTS.md"), "utf8");
      expect(agents).toContain("CORE-RULES-XYZ");
      expect(agents).toContain("CONV-RULES-XYZ");
    }
    expect(res.every((r) => r.path && !r.error)).toBe(true);
  });

  it("单个坏仓不中断其余仓：缺失目录返回 error，好仓照常写入", async () => {
    const missing = join(tmpdir(), "kp-does-not-exist-zzz", "nope");
    const res = await compileAll(kunpengRoot, [
      { id: "bad", repoPath: missing },
      { id: "good", repoPath: proj1 },
    ]);
    expect(res).toHaveLength(2);
    const bad = res.find((r) => r.id === "bad")!;
    const good = res.find((r) => r.id === "good")!;
    expect(bad.error).toBeTruthy();
    expect(good.error).toBeFalsy();
    expect(good.path).toBeTruthy();
    await stat(join(proj1, "AGENTS.md")); // 好仓确实落盘，不抛即通过
  });
});
