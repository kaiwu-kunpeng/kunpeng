import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { runScopeCheck } from "../src/cli.js";

let repo: string;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-scope-check-"));
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  await git.checkoutLocalBranch("main");
  writeFileSync(join(repo, "README.md"), "base\n");
  await git.add(".");
  await git.commit("init");

  await git.checkoutLocalBranch("kp/f1");
  mkdirSync(join(repo, "src", "out"), { recursive: true });
  writeFileSync(join(repo, "src", "out", "x.ts"), "export const x = 1;\n");
  await git.add(".");
  await git.commit("flow change");
  await git.checkout("main");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("reports scope drift from a real flow branch diff", async () => {
  const specText = [
    "# Spec",
    "",
    "```scope",
    "allow: src/in/**",
    "```",
  ].join("\n");

  const result = await runScopeCheck(specText, repo, "f1");

  expect(result.status).toBe("failed");
  expect(result.exitCode).toBe(2);
  expect(result.changedFiles).toEqual(["src/out/x.ts"]);
  expect(result.violations).toEqual([{ file: "src/out/x.ts", rule: "outside-allow" }]);
  expect(result.messages).toContain("[范围越界] src/out/x.ts（outside-allow）");
});

test("skips when the spec has no scope declaration", async () => {
  const result = await runScopeCheck("# Spec\n\nNo scope here.\n", repo, "f1");

  expect(result.status).toBe("skipped");
  expect(result.exitCode).toBe(0);
  expect(result.changedFiles).toEqual([]);
  expect(result.violations).toEqual([]);
  expect(result.messages).toEqual(["该 spec 未声明 ```scope 范围，跳过范围门"]);
});
