import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../src/artifacts/store.js";
import { collectState } from "../src/server/state.js";

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-pm-"));
  const g = simpleGit(repo);
  await g.init(); await g.addConfig("user.email", "t@t").addConfig("user.name", "t");
  await g.checkoutLocalBranch("main");
  writeFileSync(join(repo, "a.txt"), "x"); await g.add("a.txt"); await g.commit("init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("plan 已经 merge 进 main 但分支被删 → merged 仍为 true（从 merge 历史认）", async () => {
  const g = simpleGit(repo);
  const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  // 造一个 verified plan 工件 + 它的集成分支已 merge 进 main 后被删
  await store.write({ kind: "plan", id: "plan-abc", status: "verified", body: "p", meta: {} });
  await g.checkoutLocalBranch("kp/plan-abc");
  writeFileSync(join(repo, "b.txt"), "y"); await g.add("b.txt"); await g.commit("feat");
  await g.checkout("main");
  await g.merge(["--no-ff", "kp/plan-abc"]);          // 合并产生 "Merge branch 'kp/plan-abc'"
  await g.deleteLocalBranch("kp/plan-abc", true);     // gc 删分支
  const st = await collectState(store, repo);
  const pm = st.plans.find((p) => p.id === "plan-abc")!;
  expect(pm.merged).toBe(true);                       // 分支没了，但 merge 历史认得出
});
