import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../src/artifacts/store.js";
import { FakeRunner } from "../src/agent/runner.js";
import { Workspace } from "../src/git/workspace.js";
import { DevCycle } from "../src/loop/dev-cycle.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { extractTestFiles, missingTestFiles } from "../src/loop/audit.js";

// ── 单元：extractTestFiles 只抽 .test/.spec 文件，忽略其它 token ──
test("extractTestFiles 抽出点名测试文件，忽略非测试 token", () => {
  expect(extractTestFiles("npx vitest run test/a.test.ts test/b.test.ts")).toEqual(["test/a.test.ts", "test/b.test.ts"]);
  expect(extractTestFiles("cd orchestrator && npx tsc --noEmit && npx vitest run test/x.spec.ts")).toEqual(["test/x.spec.ts"]);
  expect(extractTestFiles('node -e "process.exit(0)"')).toEqual([]);
  expect(extractTestFiles("npm test")).toEqual([]);
  // 去重 + 保序
  expect(extractTestFiles("vitest run test/a.test.ts test/a.test.ts test/c.test.js")).toEqual(["test/a.test.ts", "test/c.test.js"]);
});

// ── 单元（真 fs）：missingTestFiles 必须尊重前导 cd ──
let probe: string;
beforeEach(() => { probe = mkdtempSync(join(tmpdir(), "kp-audit-probe-")); });
afterEach(() => rmSync(probe, { recursive: true, force: true }));

test("missingTestFiles：尊重前导 cd；存在判空，缺失点名", () => {
  mkdirSync(join(probe, "orchestrator", "test"), { recursive: true });
  writeFileSync(join(probe, "orchestrator", "test", "real.test.ts"), "//\n");
  expect(missingTestFiles("cd orchestrator && npx vitest run test/real.test.ts", probe)).toEqual([]);
  expect(missingTestFiles("cd orchestrator && npx vitest run test/ghost.test.ts", probe)).toEqual(["test/ghost.test.ts"]);
  expect(missingTestFiles('node -e "process.exit(0)"', probe)).toEqual([]);
});

// ── 集成（真 git + DevCycle）：点名却没创建的测试文件必须挡住 verified ──
let repo: string;
let store: ArtifactStore;
let ws: Workspace;
let tracker: FlowTracker;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-audit-dc-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
  store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  ws = new Workspace(repo);
  tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("DevCycle：验收命令点名的测试文件从未落盘 → 不得 verified，且证据点名该文件", async () => {
  const runner = new FakeRunner({
    spec: { text: "## acceptance\n- ok", meta: {}, backend: "claude" },
    implement: { text: "done", meta: {}, backend: "claude" },
  });
  const dc = new DevCycle({
    store, ws, runner, flowId: "ghost-named", tracker,
    acceptanceCmd: "npx vitest run test/ghost-never-created.test.ts",
  });
  const result = await dc.run("点名一个不存在的测试文件");
  expect(result.status).not.toBe("verified");
  expect(result.evidence ?? "").toContain("ghost-never-created.test.ts");
});

test("DevCycle：自包含验收命令(node -e) 不点名测试文件 → 既有行为不破，仍 verified", async () => {
  const runner = new FakeRunner({
    spec: { text: "## acceptance\n- ok", meta: {}, backend: "claude" },
    implement: { text: "done", meta: {}, backend: "claude" },
  });
  const dc = new DevCycle({
    store, ws, runner, flowId: "no-named", tracker,
    acceptanceCmd: 'node -e "process.exit(0)"',
  });
  const result = await dc.run("自包含验收命令");
  expect(result.status).toBe("verified");
});