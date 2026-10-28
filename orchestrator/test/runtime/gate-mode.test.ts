import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatObserveWarn,
  gateModeEnvKey,
  gateModeFor,
  gateObservationsPath,
  gatesConfigPath,
  legacyRepoGatesConfigPath,
  readGatesConfig,
  recordGateObservation,
  resolveGateMode,
  summarizeGateObservations,
} from "../../src/runtime/gate-mode.js";

let repo: string;
let stateDir: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-gate-mode-"));
  stateDir = mkdtempSync(join(tmpdir(), "kp-gate-mode-state-"));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

describe("resolveGateMode 三级优先级(作者锁定)", () => {
  test("env > gates.json > 默认 block;非法值视为未设", () => {
    expect(gateModeEnvKey("scope")).toBe("KUNPENG_GATE_MODE_SCOPE");
    expect(gateModeEnvKey("merge-review")).toBe("KUNPENG_GATE_MODE_MERGE_REVIEW");
    // 默认
    expect(resolveGateMode("scope", {})).toBe("block");
    expect(resolveGateMode("scope", {}, {})).toBe("block");
    // 配置文件层
    expect(resolveGateMode("scope", {}, { scope: "observe" })).toBe("observe");
    expect(resolveGateMode("audit", {}, { scope: "observe" })).toBe("block");
    // env 压过配置(两个方向都锁)
    expect(resolveGateMode("scope", { KUNPENG_GATE_MODE_SCOPE: "observe" }, { scope: "block" })).toBe("observe");
    expect(resolveGateMode("scope", { KUNPENG_GATE_MODE_SCOPE: "block" }, { scope: "observe" })).toBe("block");
    // 大小写/空白宽容,非法值忽略并落到下一层
    expect(resolveGateMode("scope", { KUNPENG_GATE_MODE_SCOPE: " Observe " })).toBe("observe");
    expect(resolveGateMode("scope", { KUNPENG_GATE_MODE_SCOPE: "yes" }, { scope: "observe" })).toBe("observe");
    expect(resolveGateMode("scope", {}, { scope: "maybe" })).toBe("block");
  });

  test("gateModeFor 读 <stateDir>/gates.json;仓内 gates.json 惰性只 warn;不存在=block;损坏 warn+skip 不抛;stateDir 缺失=env-only", () => {
    const warns: string[] = [];
    const warn = (m: string) => warns.push(m);
    expect(gateModeFor("scope", repo, { KUNPENG_STATE: stateDir }, warn)).toBe("block");
    expect(readGatesConfig(stateDir, warn)).toEqual({});
    expect(warns).toEqual([]);

    writeFileSync(gatesConfigPath(stateDir), JSON.stringify({ scope: "observe", audit: 1 }));
    expect(gateModeFor("scope", repo, { KUNPENG_STATE: stateDir }, warn)).toBe("observe");
    expect(gateModeFor("audit", repo, { KUNPENG_STATE: stateDir }, warn)).toBe("block");
    expect(warns.some((m) => m.includes("audit"))).toBe(true);

    writeFileSync(gatesConfigPath(stateDir), "{ not json");
    warns.length = 0;
    expect(gateModeFor("scope", repo, { KUNPENG_STATE: stateDir }, warn)).toBe("block");
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("gates.json");

    writeFileSync(gatesConfigPath(stateDir), "[1,2]");
    warns.length = 0;
    expect(readGatesConfig(stateDir, warn)).toEqual({});
    expect(warns).toHaveLength(1);

    expect(gateModeFor("scope", undefined, { KUNPENG_GATE_MODE_SCOPE: "observe" }, warn)).toBe("observe");
    expect(gateModeFor("scope", undefined, {}, warn)).toBe("block");

    writeFileSync(gatesConfigPath(stateDir), "{}");
    mkdirSync(join(repo, ".kunpeng"));
    writeFileSync(legacyRepoGatesConfigPath(repo), JSON.stringify({ scope: "observe" }));
    warns.length = 0;
    expect(gateModeFor("scope", repo, { KUNPENG_STATE: stateDir }, warn)).toBe("block");
    expect(warns.some((m) => m.includes("已不再生效"))).toBe(true);
  });
});

describe("观察账本(作者锁定)", () => {
  test("recordGateObservation 追加 JSONL(自动建 .kunpeng);写失败只 warn 不抛", () => {
    recordGateObservation(repo, { gate: "scope", flowId: "f1", wouldBlock: true, reason: "src/out/x.ts（outside-allow）", at: 1 });
    recordGateObservation(repo, { gate: "audit", flowId: "f2", wouldBlock: true, reason: "弱测试", at: 2, mode: "observe" });
    const lines = readFileSync(gateObservationsPath(repo), "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ gate: "scope", flowId: "f1", wouldBlock: true, reason: "src/out/x.ts（outside-allow）", at: 1 });
    expect(JSON.parse(lines[1]!)).toMatchObject({ gate: "audit", flowId: "f2", mode: "observe" });

    // repoRoot 是个普通文件 → mkdir/append 必失败 → 只 warn
    const notADir = join(repo, "plain-file");
    writeFileSync(notADir, "x");
    const warns: string[] = [];
    expect(() => recordGateObservation(notADir, { gate: "scope", flowId: "f3", wouldBlock: true, reason: "r", at: 3 }, (m) => warns.push(m))).not.toThrow();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("[gate:scope]");
    // repoRoot 缺失 → 不落盘、只 warn
    warns.length = 0;
    recordGateObservation(undefined, { gate: "audit", flowId: "f4", wouldBlock: true, reason: "r", at: 4 }, (m) => warns.push(m));
    expect(warns).toHaveLength(1);
  });

  test("summarizeGateObservations 按 gate 汇总,跳过空行/坏行/缺 gate 的行", () => {
    const lines = [
      JSON.stringify({ gate: "scope", flowId: "a", wouldBlock: true, reason: "r", at: 1 }),
      "",
      "not json",
      JSON.stringify({ gate: "scope", flowId: "b", wouldBlock: false, reason: "r", at: 2 }),
      JSON.stringify({ gate: "audit", flowId: "c", wouldBlock: true, reason: "r", at: 3 }),
      JSON.stringify({ flowId: "no-gate", wouldBlock: true }),
      JSON.stringify(42),
    ];
    expect(summarizeGateObservations(lines)).toEqual({
      scope: { total: 2, wouldBlock: 1 },
      audit: { total: 1, wouldBlock: 1 },
    });
    expect(summarizeGateObservations([])).toEqual({});
  });

  test("observe 放行文案格式固定", () => {
    expect(formatObserveWarn("scope", "src/x.ts（forbidden）")).toBe("[gate:scope] observe 模式：本会拦下 → src/x.ts（forbidden）");
  });
});