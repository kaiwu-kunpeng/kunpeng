import { describe, expect, it } from "vitest";
import { resolveCliActor } from "../../src/runtime/cli-actor.js";
import { buildGateStats, formatGateStatsReport } from "../../src/metrics/gate-ledger.js";
import type { GateLedgerEntry } from "../../src/runtime/flowstate.js";

describe("resolveCliActor", () => {
  it("--actor 显式参数优先，并从 args 中剔除", () => {
    const r = resolveCliActor(["f1", "--actor", "machine", "main"], { CLAUDECODE: "1", KUNPENG_ACTOR: "human" });
    expect(r.by).toBe("machine");
    expect(r.args).toEqual(["f1", "main"]);
  });

  it("--actor 非法值抛错", () => {
    expect(() => resolveCliActor(["f1", "--actor", "robot"], {})).toThrow(/--actor/);
  });

  it("无参数时 KUNPENG_ACTOR 优先于会话信号（machine）", () => {
    expect(resolveCliActor(["f1"], { KUNPENG_ACTOR: "machine", CLAUDECODE: "1" }).by).toBe("machine");
  });

  it("KUNPENG_ACTOR 非法则忽略，继续看会话信号", () => {
    expect(resolveCliActor(["f1"], { KUNPENG_ACTOR: "robot", CLAUDECODE: "1" }).by).toBe("agent");
  });

  it("Claude Code 会话 → agent", () => {
    expect(resolveCliActor(["f1"], { CLAUDECODE: "1" }).by).toBe("agent");
  });

  it("Codex 会话 → agent", () => {
    expect(resolveCliActor(["f1"], { CODEX_SANDBOX: "seatbelt" }).by).toBe("agent");
  });

  it("空的 CODEX_ 键不算", () => {
    expect(resolveCliActor(["f1"], { CODEX_HOME: "" }).by).toBe("human");
  });

  it("什么信号都没有 → human，args 原样", () => {
    const r = resolveCliActor(["f1", "main"], {});
    expect(r.by).toBe("human");
    expect(r.args).toEqual(["f1", "main"]);
  });
});

describe("门账本单列 agent", () => {
  const T0 = Date.UTC(2026, 9, 1);
  const DAY = 86_400_000;
  const entry = (over: Partial<GateLedgerEntry>): GateLedgerEntry => ({
    gate: "合并主干 (人工门#1)", what: "kp/x → main", openedAt: T0, closedAt: T0 + DAY, durationMs: 60_000,
    by: "human", via: "cli-merge", planGate: false, ...over,
  });

  it("agent 与 human/machine 分开计数并进报告", () => {
    const flows = [
      { flowId: "a", gateLedger: [entry({ by: "human" })], humanGate: undefined },
      { flowId: "b", gateLedger: [entry({ by: "agent", closedAt: T0 + 2 * DAY })], humanGate: undefined },
      { flowId: "c", gateLedger: [entry({ by: "agent", closedAt: T0 + 3 * DAY })], humanGate: undefined },
      { flowId: "d", gateLedger: [entry({ by: "machine", via: "autopilot-cli", closedAt: T0 + 4 * DAY })], humanGate: undefined },
    ];
    const s = buildGateStats(flows, { sinceMs: T0, untilMs: T0 + 14 * DAY });
    expect(s.human).toBe(1);
    expect(s.agent).toBe(2);
    expect(s.machine).toBe(1);
    expect(s.agentPerWeek).toBe(1);
    expect(formatGateStatsReport(s)).toContain("agent 代点的门/周：1（共 2 扇）");
  });
});