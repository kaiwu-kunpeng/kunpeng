import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { gateObservationsPath } from "../../src/runtime/gate-mode.js";
import { createLogger } from "../../src/runtime/logger.js";

// 本文件整体嵌在 spec 的围栏里,正文不能出现三个反引号,围栏用拼接生成。
const FENCE = "`".repeat(3);
const ENV_KEYS = ["KUNPENG_GATE_MODE_SCOPE", "KUNPENG_GATE_MODE_AUDIT", "KUNPENG_REQUIRE_SCOPE", "KUNPENG_KEEP_WORKTREE"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let repo: string;

// 09-16/09-17 真机事故文件:被清成 0 字节的那个测试。
const INCIDENT_FILE = "orchestrator/test/server/architecture-graph.test.ts";
const LOCKED_FILE = "orchestrator/test/verify/locked-demo.test.ts";
const SCOPED_REQ = ["# 在 src/in 下加一个文件", "", `${FENCE}scope`, "allow: src/in/**", FENCE].join("\n");
const TEST_ALLOWED_REQ = ["# 合法改测试的流", "", `${FENCE}scope`, "allow: src/in/**", "allow: orchestrator/test/**", FENCE].join("\n");
const NO_SCOPE_REQ = "# 没有范围声明的需求";
const LOCKED_NO_SCOPE_REQ = ["# 带作者锁定文件、无 scope 的需求", "", `${FENCE}accept-file path=${LOCKED_FILE}`, "export {};", FENCE].join("\n");

/** implement 阶段真往 worktree 写文件的 runner:模拟实现者顺手篡改评测资产。 */
class WritingRunner implements AgentRunner {
  constructor(private readonly files: Record<string, string>) {}
  async run(req: AgentRequest): Promise<AgentResult> {
    if (req.stage === "spec") return { text: "## acceptance\n- ok", meta: {}, backend: "claude" };
    if (req.stage === "implement") {
      for (const [rel, content] of Object.entries(this.files)) {
        const target = join(req.cwd ?? repo, rel);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, "utf8");
      }
      return { text: "done", meta: {}, backend: "claude" };
    }
    throw new Error(`unexpected stage ${req.stage}`);
  }
}

function ledger(root: string): Record<string, unknown>[] {
  if (!existsSync(gateObservationsPath(root))) return [];
  return readFileSync(gateObservationsPath(root), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

function makeCycle(flowId: string, files: Record<string, string>, marker: string): DevCycle {
  return new DevCycle({
    store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
    ws: new Workspace(repo),
    tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
    runner: new WritingRunner(files),
    flowId,
    // 验收命令留下标记:守卫必须在 verify 之前拦下,标记不得出现。
    acceptanceCmd: `touch "${marker}" && grep -q base README.md`,
    logger: createLogger({ minLevel: "warn", sink: () => {} }),
  });
}

beforeEach(async () => {
  for (const key of ENV_KEYS) { savedEnv[key] = process.env[key]; delete process.env[key]; }
  repo = mkdtempSync(join(tmpdir(), "kp-eval-tamper-"));
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  await git.checkoutLocalBranch("main");
  writeFileSync(join(repo, "README.md"), "base\n");
  mkdirSync(join(repo, "orchestrator", "test", "server"), { recursive: true });
  writeFileSync(join(repo, INCIDENT_FILE), "import { test } from \"vitest\";\ntest(\"graph\", () => {});\n");
  await git.add(".");
  await git.commit("init");
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(repo, { recursive: true, force: true });
});

describe("评测资产守卫（verify 之前、确定性、fail-closed）", () => {
  test("scope 未放行却清空既有测试 → verify 之前 rolled-back，kind=eval-tamper，不进人工门", async () => {
    const marker = join(repo, "accept-ran-1");
    const result = await makeCycle("tamper-existing", { "src/in/y.ts": "y\n", [INCIDENT_FILE]: "" }, marker).run(SCOPED_REQ);
    expect(result.status).toBe("rolled-back");
    expect(result.evidence ?? "").toContain("评测资产守卫");
    expect(result.evidence ?? "").toContain(INCIDENT_FILE);
    expect(existsSync(marker)).toBe(false);
    const state = await new FlowTracker(join(repo, ".kunpeng", "state")).read("tamper-existing");
    expect(state?.status).toBe("rolled-back");
    expect(state?.rollback?.kind).toBe("eval-tamper");
    expect(state?.humanGate).toBeUndefined();
    const rows = ledger(repo).filter((r) => r.gate === "eval-tamper");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ flowId: "tamper-existing", wouldBlock: true, mode: "block" });
  });

  test("scope allow 显式覆盖 orchestrator/test/** → 同样的改动 verified", async () => {
    const marker = join(repo, "accept-ran-2");
    const result = await makeCycle("tamper-allowed", { "src/in/y.ts": "y\n", "orchestrator/test/verify/new-demo.test.ts": "export {};\n" }, marker).run(TEST_ALLOWED_REQ);
    expect(result.status).toBe("verified");
    expect(existsSync(marker)).toBe(true);
    expect(ledger(repo).filter((r) => r.gate === "eval-tamper")).toEqual([]);
  });

  test("无 scope 且 KUNPENG_REQUIRE_SCOPE 未设 → 新增测试文件照样 rolled-back（守卫不依赖 requireScope）", async () => {
    const marker = join(repo, "accept-ran-3");
    const result = await makeCycle("tamper-no-scope", { "src/in/y.ts": "y\n", "orchestrator/test/verify/sneaky.test.ts": "export {};\n" }, marker).run(NO_SCOPE_REQ);
    expect(result.status).toBe("rolled-back");
    expect(result.evidence ?? "").toContain("orchestrator/test/verify/sneaky.test.ts");
    expect(existsSync(marker)).toBe(false);
    const state = await new FlowTracker(join(repo, ".kunpeng", "state")).read("tamper-no-scope");
    expect(state?.rollback?.kind).toBe("eval-tamper");
  });

  test("作者锁定文件豁免：实现者写了与锁定块同路径的文件不算篡改 → verified", async () => {
    const marker = join(repo, "accept-ran-4");
    const result = await makeCycle("tamper-locked-exempt", { "src/in/y.ts": "y\n", [LOCKED_FILE]: "export {};\n" }, marker).run(LOCKED_NO_SCOPE_REQ);
    expect(result.status).toBe("verified");
    expect(existsSync(marker)).toBe(true);
  });

  test("只改普通文件 → verified，账本无 eval-tamper 行", async () => {
    const marker = join(repo, "accept-ran-5");
    const result = await makeCycle("tamper-none", { "src/in/y.ts": "y\n" }, marker).run(SCOPED_REQ);
    expect(result.status).toBe("verified");
    expect(ledger(repo).filter((r) => r.gate === "eval-tamper")).toEqual([]);
  });
});