import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { collectState } from "../../src/server/state.js";

let parent: string, repo: string;
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), "kp-loc-"));
  repo = join(parent, "proj-" + Math.floor(performance.now()));
  mkdirSync(repo);
});
afterEach(() => rmSync(parent, { recursive: true, force: true }));

test("非 monorepo 项目(只有 repo 根 src/)代码行数能显示,不再为 0", async () => {
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.ts"), "const a = 1;\nconst b = 2;", "utf8"); // 2 行
  const st = await collectState(new ArtifactStore(join(repo, ".kunpeng", "artifacts")), repo);
  expect(st.code.srcLines).toBe(2);
});

test("monorepo 布局(orchestrator/src)仍优先生效", async () => {
  mkdirSync(join(repo, "orchestrator", "src"), { recursive: true });
  writeFileSync(join(repo, "orchestrator", "src", "c.ts"), "x\ny\nz", "utf8"); // 3 行
  // 同时放一个 repo 根 src 干扰,确认 orchestrator 优先(非两者相加)
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "d.ts"), "1\n2\n3\n4\n5", "utf8"); // 5 行
  const st = await collectState(new ArtifactStore(join(repo, ".kunpeng", "artifacts")), repo);
  expect(st.code.srcLines).toBe(3);
});