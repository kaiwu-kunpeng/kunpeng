import { describe, expect, it } from "vitest";
import { runAutopilot, type AutopilotDeps } from "../../src/loop/autopilot.js";
import type { FlowState } from "../../src/runtime/flowstate.js";
import type { SensitiveHit } from "../../src/runtime/sensitive-paths.js";

const AUTH_HIT: SensitiveHit = { file: "orchestrator/src/server/auth.ts", label: "鉴权/授权" };
const POOL_HIT: SensitiveHit = { file: "orchestrator/src/agent/account-pool.ts", label: "账号池" };

function flow(overrides: Partial<FlowState> = {}): FlowState {
  return {
    flowId: "sens-flow",
    requirement: "更新普通实现",
    stage: "done",
    status: "verified",
    agentActive: false,
    humanGate: { gate: "合并主干 (人工门#1)", what: "kp/sens-flow → main" },
    startedAt: 1,
    updatedAt: 2,
    history: [],
    ...overrides,
  };
}

interface Harness {
  deps: AutopilotDeps;
  mergeCalls: [string, string][];
  markCalls: [string, SensitiveHit[]][];
  sensitiveCalls: [string, string][];
  logs: string[];
  discards: string[];
}

function harness(opts: {
  flows?: FlowState[];
  sensitive?: { hits: SensitiveHit[] } | Error;
  futile?: boolean;
  publicSurface?: boolean;
} = {}): Harness {
  const flows = opts.flows ?? [flow()];
  const h: Harness = { mergeCalls: [], markCalls: [], sensitiveCalls: [], logs: [], discards: [], deps: undefined as unknown as AutopilotDeps };
  const tracker = {
    list: async () => flows,
    markSensitive: async (flowId: string, hits: SensitiveHit[]) => { h.markCalls.push([flowId, hits]); },
    clearGate: async (flowId: string) => { h.discards.push(flowId); },
  } as unknown as AutopilotDeps["tracker"];
  h.deps = {
    tracker,
    merge: async (flowId, base) => { h.mergeCalls.push([flowId, base]); return { ok: true }; },
    log: (line) => { h.logs.push(line); },
  };
  if (opts.sensitive !== undefined) {
    const verdict = opts.sensitive;
    h.deps.sensitive = async (flowId, base) => {
      h.sensitiveCalls.push([flowId, base]);
      if (verdict instanceof Error) throw verdict;
      return verdict;
    };
  }
  if (opts.futile !== undefined) {
    const futile = opts.futile;
    h.deps.futile = async () => ({ futile, reason: futile ? "分支缺失" : undefined });
    h.deps.discard = async (flowId) => { await tracker.clearGate(flowId); };
  }
  if (opts.publicSurface !== undefined) {
    const touched = opts.publicSurface;
    h.deps.publicSurface = async () => ({ touched, files: touched ? ["lib/i18n.ts"] : [] });
  }
  return h;
}

describe("runAutopilot 敏感路径人工门(作者锁定)", () => {
  it("闸命中 → 打标 sensitive、留门不合并、skipped 理由带标签、打一行日志", async () => {
    const h = harness({ sensitive: { hits: [AUTH_HIT, POOL_HIT] } });

    const result = await runAutopilot(h.deps);

    expect(result.merged).toEqual([]);
    expect(h.mergeCalls).toEqual([]);
    expect(h.sensitiveCalls).toEqual([["sens-flow", "main"]]);
    expect(h.markCalls).toEqual([["sens-flow", [AUTH_HIT, POOL_HIT]]]);
    expect(result.skipped).toEqual([{ flowId: "sens-flow", reason: "敏感路径改动需人工合并：鉴权/授权、账号池" }]);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toContain("[autopilot]");
    expect(h.logs[0]).toContain("sens-flow");
    expect(h.logs[0]).toContain("鉴权/授权");
  });

  it("已打标 sensitive 且门未清的流:不再跑闸、不合并、每轮仍打一行日志", async () => {
    const h = harness({
      flows: [flow({ sensitive: { hits: [AUTH_HIT], at: 10 }, humanGate: { gate: "合并主干 (人工门#1) · 敏感路径改动需人工合并：鉴权/授权", what: "kp/sens-flow → main" } })],
      sensitive: { hits: [] },
    });

    const result = await runAutopilot(h.deps);

    expect(result.merged).toEqual([]);
    expect(h.mergeCalls).toEqual([]);
    expect(h.sensitiveCalls).toEqual([]);
    expect(h.markCalls).toEqual([]);
    expect(result.skipped).toEqual([{ flowId: "sens-flow", reason: "敏感路径改动需人工合并：鉴权/授权" }]);
    expect(h.logs).toHaveLength(1);
  });

  it("已打标但门已清(人工合并过)的流不再是候选", async () => {
    const h = harness({
      flows: [flow({ sensitive: { hits: [AUTH_HIT], at: 10 }, humanGate: undefined })],
      sensitive: { hits: [AUTH_HIT] },
    });

    const result = await runAutopilot(h.deps);

    expect(result).toEqual({ merged: [], skipped: [], rejected: [] });
    expect(h.logs).toEqual([]);
  });

  it("闸未命中 → 正常合并,不打标", async () => {
    const h = harness({ sensitive: { hits: [] } });

    const result = await runAutopilot(h.deps);

    expect(result.merged).toEqual(["sens-flow"]);
    expect(h.mergeCalls).toEqual([["sens-flow", "main"]]);
    expect(h.markCalls).toEqual([]);
    expect(h.logs).toEqual([]);
  });

  it("闸异常 → 保守保留门、不打标、不合并", async () => {
    const h = harness({ sensitive: new Error("git diff 失败") });

    const result = await runAutopilot(h.deps);

    expect(result.merged).toEqual([]);
    expect(h.markCalls).toEqual([]);
    expect(result.skipped[0]!.reason).toContain("敏感路径检测异常");
    expect(result.skipped[0]!.reason).toContain("git diff 失败");
  });

  it("未注入敏感闸 → 保持原有合并行为", async () => {
    const h = harness();

    const result = await runAutopilot(h.deps);

    expect(result.merged).toEqual(["sens-flow"]);
  });

  it("闸顺序:futile(分支缺失)先自动驳回,敏感闸不被调用;敏感命中时对外面闸不再调用", async () => {
    const futileFirst = harness({ futile: true, sensitive: { hits: [AUTH_HIT] } });
    const r1 = await runAutopilot(futileFirst.deps);
    expect(r1.rejected.map((item) => item.flowId)).toEqual(["sens-flow"]);
    expect(futileFirst.sensitiveCalls).toEqual([]);
    expect(futileFirst.discards).toEqual(["sens-flow"]);

    const sensitiveBeforeSurface = harness({ futile: false, sensitive: { hits: [AUTH_HIT] }, publicSurface: true });
    const r2 = await runAutopilot(sensitiveBeforeSurface.deps);
    expect(r2.skipped).toEqual([{ flowId: "sens-flow", reason: "敏感路径改动需人工合并：鉴权/授权" }]);
    expect(sensitiveBeforeSurface.markCalls).toHaveLength(1);
  });

  it("多流:只有敏感流被拦,其余照常合并", async () => {
    const flows = [
      flow({ flowId: "plain", humanGate: { gate: "合并主干 (人工门#1)", what: "kp/plain → main" } }),
      flow({ flowId: "sens", humanGate: { gate: "合并主干 (人工门#1)", what: "kp/sens → main" } }),
    ];
    const h = harness({ flows });
    h.deps.sensitive = async (flowId) => ({ hits: flowId === "sens" ? [POOL_HIT] : [] });

    const result = await runAutopilot(h.deps);

    expect(result.merged).toEqual(["plain"]);
    expect(result.skipped).toEqual([{ flowId: "sens", reason: "敏感路径改动需人工合并：账号池" }]);
    expect(h.markCalls).toEqual([["sens", [POOL_HIT]]]);
  });
});