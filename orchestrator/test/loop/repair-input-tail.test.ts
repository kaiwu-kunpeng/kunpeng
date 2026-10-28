import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";

// 真实形态：先吐几万字符启动噪声（模拟 vitest 的文件列表 + git 噪声），
// 失败标记只出现在最尾部。改动前 slice(0, 4000) 必然看不到它。
const NOISE_LINES = 600;
const TAIL_MARKER = "TAILONLYMARKER-expected-result-txt-to-contain-ok";
const bigOutputAcceptance = [
  "node -e",
  JSON.stringify(
    `for (let i = 0; i < ${NOISE_LINES}; i++) ` +
      "console.error('fatal: not a git repository (or any of the parent directories): .git');" +
      "const fs = require('fs');" +
      "const actual = fs.existsSync('result.txt') ? fs.readFileSync('result.txt', 'utf8').trim() : '<missing>';" +
      "if (actual === 'ok') process.exit(0);" +
      `console.error('${TAIL_MARKER} got ' + actual);` +
      "process.exit(1);",
  ),
].join(" ");

// 小输出对照：确认既有行为没被改坏
const smallOutputAcceptance = [
  "node -e",
  JSON.stringify(
    "const fs = require('fs');" +
      "const actual = fs.existsSync('result.txt') ? fs.readFileSync('result.txt', 'utf8').trim() : '<missing>';" +
      "if (actual === 'ok') process.exit(0);" +
      "console.error('small-diagnostic got ' + actual);" +
      "process.exit(1);",
  ),
].join(" ");

class CapturingRunner implements AgentRunner {
  readonly implementInputs: string[] = [];

  constructor(
    private readonly acceptanceCmd: string,
    private readonly writeForAttempt: (attempt: number) => string,
  ) {}

  async run(req: AgentRequest): Promise<AgentResult> {
    if (req.stage === "spec") {
      return {
        text: "## acceptance\n- result.txt must contain ok",
        meta: { testCmd: this.acceptanceCmd },
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
  repo = mkdtempSync(join(tmpdir(), "kp-repair-tail-"));
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

test("诊断输出很大时 repair 必须看到尾部的失败标记", async () => {
  const runner = new CapturingRunner(bigOutputAcceptance, (attempt) => (attempt === 1 ? "bad-1" : "ok"));
  const dc = new DevCycle({ store, ws, runner, flowId: "repair-sees-tail", maxRepairAttempts: 1 });

  const result = await dc.run("make result ok");

  expect(result.status).toBe("verified");
  expect(runner.implementInputs).toHaveLength(2);
  const repairInput = runner.implementInputs[1];

  // 核心：改动前这一条必然失败（尾部标记落在 slice(0,4000) 窗口之外两万多字符）
  expect(repairInput).toContain(TAIL_MARKER);
});

test("大输出被截断而不是整包塞进提示词", async () => {
  const runner = new CapturingRunner(bigOutputAcceptance, (attempt) => (attempt === 1 ? "bad-1" : "ok"));
  const dc = new DevCycle({ store, ws, runner, flowId: "repair-truncates", maxRepairAttempts: 1 });

  await dc.run("make result ok");
  const repairInput = runner.implementInputs[1];

  // 有中段截断标记
  expect(repairInput).toContain("(中段截断)");
  // 原始输出是数万字符；提示词里的诊断段必须被限制住
  expect(repairInput.length).toBeLessThan(12000);
  // 噪声不得占满：截断后保留的噪声行数远小于原始的 600 行
  const noiseCount = repairInput.split("not a git repository").length - 1;
  expect(noiseCount).toBeLessThan(NOISE_LINES / 2);
});

test("小输出对照：既有行为不变，repair 仍收到一行式诊断", async () => {
  const runner = new CapturingRunner(smallOutputAcceptance, (attempt) => (attempt === 1 ? "bad-1" : "ok"));
  const dc = new DevCycle({ store, ws, runner, flowId: "repair-small-output", maxRepairAttempts: 1 });

  const result = await dc.run("make result ok");

  expect(result.status).toBe("verified");
  expect(runner.implementInputs[1]).toContain("上一次实现未通过验证");
  expect(runner.implementInputs[1]).toContain("small-diagnostic got bad-1");
});