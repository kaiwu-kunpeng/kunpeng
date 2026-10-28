import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";

let repo: string;
let store: ArtifactStore;
let ws: Workspace;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-devcycle-design-"));
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

// 记录每个 stage 收到的 system,implement 永远成功。
class CapturingRunner implements AgentRunner {
  systemByStage: Record<string, string> = {};
  async run(req: AgentRequest): Promise<AgentResult> {
    this.systemByStage[req.stage] = req.system;
    if (req.stage === "spec") return { text: "## acceptance\n- ok", meta: { testCmd: 'node -e "process.exit(0)"' } };
    return { text: "done", meta: {} };
  }
}

test("designSystemPrompt 注入 implement 的 system,不污染 spec", async () => {
  const runner = new CapturingRunner();
  const dc = new DevCycle({
    store, ws, runner, flowId: "design-inject",
    projectRules: "PROJECT_RULES",
    designSystemPrompt: "DESIGN_SYS_PROMPT_X",
  });
  const r = await dc.run("做个设计页");
  expect(r.status).toBe("verified");
  expect(runner.systemByStage.implement).toContain("DESIGN_SYS_PROMPT_X");
  expect(runner.systemByStage.implement).toContain("PROJECT_RULES");
  expect(runner.systemByStage.spec.startsWith("PROJECT_RULES")).toBe(true);
  expect(runner.systemByStage.spec).toContain("【硬规则·压轴覆盖】");
  expect(runner.systemByStage.spec).not.toContain("DESIGN_SYS_PROMPT_X");
});

test("不给 designSystemPrompt 时 implement system 行为不变(只规则)", async () => {
  const runner = new CapturingRunner();
  const dc = new DevCycle({ store, ws, runner, flowId: "design-default", projectRules: "PROJECT_RULES" });
  await dc.run("普通需求");
  expect(runner.systemByStage.implement.startsWith("PROJECT_RULES")).toBe(true);
  expect(runner.systemByStage.implement).toContain("【硬规则·压轴覆盖】");
});
