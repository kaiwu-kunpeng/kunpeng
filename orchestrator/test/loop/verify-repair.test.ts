import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";

const acceptanceCmd = [
  "node -e",
  JSON.stringify(
    "const fs = require('fs');" +
    "const actual = fs.existsSync('result.txt') ? fs.readFileSync('result.txt', 'utf8').trim() : '<missing>';" +
    "if (actual === 'ok') process.exit(0);" +
    "console.error('expected result.txt to contain ok, got ' + actual);" +
    "process.exit(1);",
  ),
].join(" ");

class CountingRunner implements AgentRunner {
  readonly implementInputs: string[] = [];

  constructor(private readonly writeForAttempt: (attempt: number) => string) {}

  async run(req: AgentRequest): Promise<AgentResult> {
    if (req.stage === "spec") {
      return {
        text: "## acceptance\n- result.txt must contain ok",
        meta: { testCmd: acceptanceCmd },
      };
    }
    if (req.stage !== "implement") throw new Error(`unexpected stage: ${req.stage}`);
    if (!req.cwd) throw new Error("implement cwd is required");
    const attempt = this.implementInputs.length + 1;
    this.implementInputs.push(req.input);
    writeFileSync(join(req.cwd, "result.txt"), `${this.writeForAttempt(attempt)}\n`);
    return { text: `attempt ${attempt}`, meta: {} };
  }
}

let repo: string;
let store: ArtifactStore;
let ws: Workspace;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-verify-repair-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
  store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  ws = new Workspace(repo);
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("repairs once after verification failure and feeds diagnostics back to implement", async () => {
  const runner = new CountingRunner((attempt) => attempt === 1 ? "bad-1" : "ok");
  const dc = new DevCycle({ store, ws, runner, flowId: "repair-self-heals", maxRepairAttempts: 1 });

  const result = await dc.run("make result ok");

  expect(result.status).toBe("verified");
  expect(runner.implementInputs).toHaveLength(2);
  expect(runner.implementInputs[1]).toContain("上一次实现未通过验证。诊断输出如下，请据此修复（只改代码以满足验收，不要改验收命令）：");
  expect(runner.implementInputs[1]).toContain("expected result.txt to contain ok, got bad-1");
  const spec = await store.read("repair-self-heals");
  expect(spec.status).toBe("verified");
});

test("defaults to no repair attempts and rolls back after the first failed verify", async () => {
  const runner = new CountingRunner(() => "bad-1");
  const dc = new DevCycle({ store, ws, runner, flowId: "repair-default-off" });

  const result = await dc.run("make result ok");

  expect(result.status).toBe("rolled-back");
  expect(runner.implementInputs).toHaveLength(1);
  const spec = await store.read("repair-default-off");
  expect(spec.status).toBe("rolled-back");
});

test("rolls back with final verification evidence after exhausting repair attempts", async () => {
  const runner = new CountingRunner((attempt) => `bad-${attempt}`);
  const dc = new DevCycle({ store, ws, runner, flowId: "repair-exhausted", maxRepairAttempts: 2 });

  const result = await dc.run("make result ok");

  expect(result.status).toBe("rolled-back");
  expect(runner.implementInputs).toHaveLength(3);
  expect(result.evidence).toContain("expected result.txt to contain ok, got bad-3");
  expect(result.evidence).not.toContain("bad-2");
  const experiences = await store.list("experience");
  const exp = experiences.find((artifact) => artifact.meta.sourceFlow === "repair-exhausted");
  expect(exp?.meta.outcome).toBe("rolled-back");
  expect(exp?.meta.evidence).toContain("expected result.txt to contain ok, got bad-3");
});
