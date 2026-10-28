import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext } from "../src/sdk/context.js";
import { ArtifactStore } from "../src/artifacts/store.js";
import { Workspace } from "../src/git/workspace.js";
import { CliRunner } from "../src/agent/cli-runner.js";
import { FlowTracker } from "../src/runtime/flowstate.js";

let repo: string;
let home: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-sdk-context-repo-"));
  home = mkdtempSync(join(tmpdir(), "kp-sdk-context-home-"));
  mkdirSync(join(home, ".kunpeng"), { recursive: true });
  writeFileSync(join(home, ".kunpeng", "accounts.json"), JSON.stringify([
    { id: "acct-a", limit: 10, windowHours: 2 },
  ]));
  writeFileSync(join(repo, "package.json"), JSON.stringify({
    scripts: { typecheck: "tsc --noEmit" },
  }));
  writeFileSync(join(repo, "AGENTS.md"), "agent rules");
  writeFileSync(join(repo, "CLAUDE.md"), "claude rules");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("createContext assembles the orchestrator dependencies used by cli plan/run", async () => {
  const ctx = await createContext(repo, home);

  expect(ctx.store).toBeInstanceOf(ArtifactStore);
  expect(ctx.ws).toBeInstanceOf(Workspace);
  expect(ctx.runner).toBeInstanceOf(CliRunner);
  expect(ctx.tracker).toBeInstanceOf(FlowTracker);
  expect(ctx.accounts.map((a) => a.id)).toEqual(["acct-a"]);
  expect(ctx.quotaPath).toBe(join(home, ".kunpeng", "quota.json"));
  expect(ctx.checks).toEqual(["npm run typecheck"]);
  expect(ctx.projectRules).toContain("agent rules");
  expect(ctx.projectRules).toContain("claude rules");
  expect(ctx.quota.accountTotal("acct-a", Date.now())).toBe(0);
});

test("createContext appends evolution conventions to project rules", async () => {
  writeFileSync(join(repo, "AGENTS.md"), "AGENTS-RULE");
  mkdirSync(join(repo, ".kunpeng", "constitution"), { recursive: true });
  writeFileSync(join(repo, ".kunpeng", "constitution", "conventions.md"), "CONV-RULE:错误必带结构化原因");

  const ctx = await createContext(repo, home);

  expect(ctx.projectRules).toContain("AGENTS-RULE");
  expect(ctx.projectRules).toContain("CONV-RULE:错误必带结构化原因");
  expect(ctx.projectRules).toContain("演进约定");
});

test("createContext ignores missing evolution conventions", async () => {
  writeFileSync(join(repo, "AGENTS.md"), "AGENTS-ONLY");

  const ctx = await createContext(repo, home);

  expect(ctx.projectRules).toContain("AGENTS-ONLY");
  expect(ctx.projectRules).not.toContain("演进约定");
});

test("createContext returns empty project rules when rule files are absent", async () => {
  rmSync(join(repo, "AGENTS.md"), { force: true });
  rmSync(join(repo, "CLAUDE.md"), { force: true });
  rmSync(join(repo, ".kunpeng", "constitution", "conventions.md"), { force: true });

  const ctx = await createContext(repo, home);

  expect(ctx.projectRules).toBe("");
});
