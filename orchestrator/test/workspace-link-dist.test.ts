import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { Workspace } from "../src/git/workspace.js";
import { ensureFlowTmpDir, flowTmpDir } from "../src/runtime/flow-tmp.js";

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-wslink-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t");
  await g.addConfig("user.name", "t");
  mkdirSync(join(repo, "orchestrator"), { recursive: true });
  writeFileSync(join(repo, "orchestrator", "package.json"), "{}\n");
  writeFileSync(join(repo, "README.md"), "x\n");
  await g.add(".");
  await g.commit("init");
  mkdirSync(join(repo, "orchestrator", "node_modules"), { recursive: true });
  writeFileSync(join(repo, "orchestrator", "node_modules", "marker.txt"), "nm");
  mkdirSync(join(repo, "orchestrator", "dist"), { recursive: true });
  writeFileSync(join(repo, "orchestrator", "dist", "cli.js"), "// dist marker");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("worktree 软链 node_modules，但不再软链 dist（工作区自建产物）", async () => {
  const ws = new Workspace(repo);
  const flow = await ws.acquire("wslink1");
  const nm = join(flow.path, "orchestrator", "node_modules");
  expect(existsSync(nm) && lstatSync(nm).isSymbolicLink()).toBe(true);
  expect(existsSync(join(nm, "marker.txt"))).toBe(true);
  expect(existsSync(join(flow.path, "orchestrator", "dist"))).toBe(false);
  await ws.rollback("wslink1");
});

test("rollback 顺带删掉该流的独立 tmp 目录", async () => {
  const ws = new Workspace(repo);
  const flow = await ws.acquire("wslink2");
  const tmp = ensureFlowTmpDir(flow.path);
  writeFileSync(join(tmp, "scratch.txt"), "x");
  expect(existsSync(tmp)).toBe(true);
  await ws.rollback("wslink2");
  expect(existsSync(flowTmpDir(flow.path))).toBe(false);
});