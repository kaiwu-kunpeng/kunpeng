import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { FakeRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { runScopeCheck } from "../../src/cli.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { gateObservationsPath, gatesConfigPath, summarizeGateObservations } from "../../src/runtime/gate-mode.js";
import { createLogger } from "../../src/runtime/logger.js";

// 范围门 + 审计闸两处接缝:判定"应拦"→ 先记账;observe 放行(warn 一行),block 与现状完全一致。
const ENV_KEYS = ["KUNPENG_STATE", "KUNPENG_GATE_MODE_SCOPE", "KUNPENG_GATE_MODE_AUDIT", "KUNPENG_REQUIRE_SCOPE"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let repo: string;
let stateDir: string;

function ledger(root: string): Record<string, unknown>[] {
  if (!existsSync(gateObservationsPath(root))) return [];
  return readFileSync(gateObservationsPath(root), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

beforeEach(async () => {
  for (const key of ENV_KEYS) { savedEnv[key] = process.env[key]; delete process.env[key]; }
  repo = mkdtempSync(join(tmpdir(), "kp-gate-observe-"));
  stateDir = mkdtempSync(join(tmpdir(), "kp-gate-observe-state-"));
  process.env.KUNPENG_STATE = stateDir;
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  await git.checkoutLocalBranch("main");
  writeFileSync(join(repo, "README.md"), "base\n");
  await git.add(".");
  await git.commit("init");
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(repo, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

describe("范围门 runScopeCheck 的 observe 接缝(作者锁定)", () => {
  // 围栏用拼接生成:本文件整体要作为作者锁定块嵌进 spec 的 markdown 围栏里,正文不能出现三个反引号。
  const FENCE = "`".repeat(3);
  const SPEC = ["# Spec", "", `${FENCE}scope`, "allow: src/in/**", FENCE].join("\n");

  async function makeDriftBranch(): Promise<void> {
    const git = simpleGit(repo);
    await git.checkoutLocalBranch("kp/f1");
    mkdirSync(join(repo, "src", "out"), { recursive: true });
    writeFileSync(join(repo, "src", "out", "x.ts"), "export const x = 1;\n");
    await git.add(".");
    await git.commit("flow change");
    await git.checkout("main");
  }

  test("block(默认):越界照旧 failed/exitCode 2,且账本记一条 wouldBlock", async () => {
    await makeDriftBranch();
    const result = await runScopeCheck(SPEC, repo, "f1");
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(2);
    expect(result.messages).toContain("[范围越界] src/out/x.ts（outside-allow）");
    const rows = ledger(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gate: "scope", flowId: "f1", wouldBlock: true, mode: "block" });
    expect(String(rows[0]!.reason)).toContain("src/out/x.ts");
  });

  test("env KUNPENG_GATE_MODE_SCOPE=observe:同一越界 → observed/exitCode 0,violations 保留,消息是 observe 文案,账本落一行", async () => {
    await makeDriftBranch();
    process.env.KUNPENG_GATE_MODE_SCOPE = "observe";
    const result = await runScopeCheck(SPEC, repo, "f1");
    expect(result.status).toBe("observed");
    expect(result.exitCode).toBe(0);
    expect(result.changedFiles).toEqual(["src/out/x.ts"]);
    expect(result.violations).toEqual([{ file: "src/out/x.ts", rule: "outside-allow" }]);
    expect(result.messages).toEqual(["[gate:scope] observe 模式：本会拦下 → src/out/x.ts（outside-allow）"]);
    const rows = ledger(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gate: "scope", flowId: "f1", wouldBlock: true, mode: "observe", reason: "src/out/x.ts（outside-allow）" });
    expect(typeof rows[0]!.at).toBe("number");
    expect(summarizeGateObservations(readFileSync(gateObservationsPath(repo), "utf8").split("\n"))).toEqual({ scope: { total: 1, wouldBlock: 1 } });
  });

  test("状态目录 gates.json {scope:observe} 亦放行;env=block 压过配置", async () => {
    await makeDriftBranch();
    mkdirSync(join(repo, ".kunpeng"), { recursive: true });
    writeFileSync(gatesConfigPath(stateDir), JSON.stringify({ scope: "observe" }));
    expect((await runScopeCheck(SPEC, repo, "f1")).status).toBe("observed");
    process.env.KUNPENG_GATE_MODE_SCOPE = "block";
    expect((await runScopeCheck(SPEC, repo, "f1")).status).toBe("failed");
    expect(ledger(repo).map((r) => r.mode)).toEqual(["observe", "block"]);
  });

  test("范围内改动/无 scope 声明:不记账、结果不变", async () => {
    await makeDriftBranch();
    process.env.KUNPENG_GATE_MODE_SCOPE = "observe";
    expect((await runScopeCheck([`${FENCE}scope`, "allow: src/**", FENCE].join("\n"), repo, "f1")).status).toBe("passed");
    expect((await runScopeCheck("# Spec\n\nNo scope here.\n", repo, "f1")).status).toBe("skipped");
    expect(ledger(repo)).toEqual([]);
  });
});

describe("审计闸(DevCycle audit 阶段)的 observe 接缝(作者锁定)", () => {
  // `test -f README.md` 是审计闸判弱的典型输入(仅存在性检查);observe 放行后 verify 真跑它且通过 → verified。
  const WEAK_CMD = "test -f README.md";

  function makeCycle(flowId: string, logs: string[]): DevCycle {
    const runner = new FakeRunner({
      spec: { text: "## acceptance\n- ok", meta: {}, backend: "claude" },
      implement: { text: "done", meta: {}, backend: "claude" },
    });
    return new DevCycle({
      store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
      ws: new Workspace(repo),
      tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
      runner,
      flowId,
      acceptanceCmd: WEAK_CMD,
      logger: createLogger({ minLevel: "warn", sink: (line) => logs.push(line) }),
    });
  }

  test("block(默认):弱验收照旧 rolled-back,证据点名审计,账本记 wouldBlock/mode=block", async () => {
    const logs: string[] = [];
    const result = await makeCycle("audit-block", logs).run("弱验收命令");
    expect(result.status).toBe("rolled-back");
    expect(result.evidence ?? "").toContain("验收测试审计未通过");
    const rows = ledger(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gate: "audit", flowId: "audit-block", wouldBlock: true, mode: "block" });
    expect(String(rows[0]!.reason)).toContain("验收测试审计未通过");
    expect(logs.some((l) => l.includes("observe 模式"))).toBe(false);
  });

  test("env KUNPENG_GATE_MODE_AUDIT=observe:同一弱验收放行 → 走完 implement/verify 得 verified;warn 一行;账本落一行", async () => {
    process.env.KUNPENG_GATE_MODE_AUDIT = "observe";
    const logs: string[] = [];
    const result = await makeCycle("audit-observe", logs).run("弱验收命令");
    expect(result.status).toBe("verified");
    expect(logs.filter((l) => l.includes("[gate:audit] observe 模式：本会拦下 → 验收测试审计未通过"))).toHaveLength(1);
    const rows = ledger(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gate: "audit", flowId: "audit-observe", wouldBlock: true, mode: "observe" });
    expect(summarizeGateObservations(readFileSync(gateObservationsPath(repo), "utf8").split("\n"))).toEqual({ audit: { total: 1, wouldBlock: 1 } });
  });

  test(".kunpeng/gates.json {audit:observe} 亦放行", async () => {
    mkdirSync(join(repo, ".kunpeng"), { recursive: true });
    writeFileSync(gatesConfigPath(stateDir), JSON.stringify({ audit: "observe" }));
    const logs: string[] = [];
    const result = await makeCycle("audit-cfg", logs).run("弱验收命令");
    expect(result.status).toBe("verified");
    expect(ledger(repo)).toHaveLength(1);
  });
});