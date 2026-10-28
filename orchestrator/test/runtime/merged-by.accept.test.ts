import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { mergeAndClearGate } from "../../src/runtime/merge-gate.js";
import { classifyMerge, type NorthstarFlow } from "../../src/metrics/northstar.js";
import type { GateLedgerEntry } from "../../src/runtime/flowstate.js";

describe("mergeAndClearGate 记录 mergedBy", () => {
  let repo: string;
  let prevState: string | undefined;
  let prevInstance: string | undefined;
  const noLlm = { guardTests: false as const, stopCheckpoint: false as const, review: async () => ({ block: false }) };
  const tracker = () => new FlowTracker(join(repo, ".kunpeng", "state"));

  async function branch(name: string, file: string, content: string): Promise<void> {
    const g = simpleGit(repo);
    await g.checkoutLocalBranch(`kp/${name}`);
    mkdirSync(join(repo, file, ".."), { recursive: true });
    writeFileSync(join(repo, file), content);
    await g.add("."); await g.commit(name);
    await g.checkout("main");
  }

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), "kp-merged-by-"));
    prevState = process.env.KUNPENG_STATE;
    prevInstance = process.env.KUNPENG_INSTANCE;
    process.env.KUNPENG_STATE = join(repo, "global-state");
    process.env.KUNPENG_INSTANCE = "merged-by-test";
    const g = simpleGit(repo);
    await g.init(); await g.addConfig("user.email", "t@t").addConfig("user.name", "t");
    await g.checkoutLocalBranch("main");
    writeFileSync(join(repo, "a.txt"), "base"); await g.add("a.txt"); await g.commit("base");
  });
  afterEach(() => {
    if (prevState === undefined) delete process.env.KUNPENG_STATE; else process.env.KUNPENG_STATE = prevState;
    if (prevInstance === undefined) delete process.env.KUNPENG_INSTANCE; else process.env.KUNPENG_INSTANCE = prevInstance;
    rmSync(repo, { recursive: true, force: true });
  });

  it("流上没挂门：合入后有 mergedBy，门账本仍空", async () => {
    await branch("nogate", "docs/x.md", "x\n");
    await tracker().start("nogate", "无门的流");
    await tracker().finish("nogate", "verified");
    const before = Date.now();
    const r = await mergeAndClearGate(repo, "nogate", "main", { ...noLlm, clearedBy: { by: "agent", via: "cli-merge" } });
    expect(r.ok).toBe(true);
    const flow = (await tracker().read("nogate"))!;
    const head = (await simpleGit(repo).raw(["rev-parse", "main"])).trim();
    expect(flow.mergedBy).toEqual({ by: "agent", via: "cli-merge", at: expect.any(Number), sha: head });
    expect(flow.mergedBy!.at).toBeGreaterThanOrEqual(before);
    expect(flow.gateLedger ?? []).toEqual([]);
  });

  it("流上挂着门：门账本与 mergedBy 都写", async () => {
    await branch("gated", "docs/y.md", "y\n");
    await tracker().start("gated", "有门的流");
    await tracker().finish("gated", "verified", { gate: "合并主干 (人工门#1)", what: "kp/gated → main" });
    const r = await mergeAndClearGate(repo, "gated", "main", { ...noLlm, clearedBy: { by: "human", via: "cockpit", durationTier: "short" } });
    expect(r.ok).toBe(true);
    const flow = (await tracker().read("gated"))!;
    expect(flow.gateLedger?.map((e) => e.by)).toEqual(["human"]);
    expect(flow.mergedBy?.by).toBe("human");
    expect(flow.mergedBy?.via).toBe("cockpit");
    expect(flow.mergedBy).not.toHaveProperty("durationTier");
  });

  it("停车（未合入）不写 mergedBy", async () => {
    await branch("parked", "orchestrator/src/loop/guardian.ts", "export const loosened = true;\n");
    await tracker().start("parked", "改门的流");
    await tracker().finish("parked", "verified", { gate: "合并主干 (人工门#1)", what: "kp/parked → main" });
    const r = await mergeAndClearGate(repo, "parked", "main", noLlm);
    expect(r.ok).toBe(false);
    expect((await tracker().read("parked"))!.mergedBy).toBeUndefined();
  });
});

describe("classifyMerge 看 mergedBy 与 history", () => {
  const entry = (over: Partial<GateLedgerEntry>): GateLedgerEntry => ({
    gate: "合并主干 (人工门#1)", what: "kp/x → main", openedAt: 0, closedAt: 5, durationMs: 5,
    by: "agent", via: "cli-merge", planGate: false, ...over,
  });

  it("只有 mergedBy → 按其 by", () => {
    expect(classifyMerge("a", [{ flowId: "a", mergedBy: { by: "machine", at: 9 } }])).toEqual({ kind: "machine", humanTouches: 0, sensitive: false });
    expect(classifyMerge("a", [{ flowId: "a", gateLedger: [], mergedBy: { by: "human", at: 9 } }])).toEqual({ kind: "human", humanTouches: 1, sensitive: false });
  });

  it("mergedBy 晚于门账本 → 以 mergedBy 为准；早于则以门账本为准", () => {
    expect(classifyMerge("a", [{ flowId: "a", gateLedger: [entry({ by: "agent", closedAt: 5 })], mergedBy: { by: "machine", at: 9 } }]).kind).toBe("machine");
    expect(classifyMerge("a", [{ flowId: "a", gateLedger: [entry({ by: "agent", closedAt: 50 })], mergedBy: { by: "machine", at: 9 } }]).kind).toBe("agent");
  });

  it("门账本里有 human 时 mergedBy 不重复计人工介入", () => {
    expect(classifyMerge("a", [{ flowId: "a", gateLedger: [entry({ by: "human" })], mergedBy: { by: "human", at: 9 } }]).humanTouches).toBe(1);
  });

  it("只有 gate-cleared history → unknown；什么都没有 → bypass", () => {
    const old: NorthstarFlow = { flowId: "a", history: [{ stage: "verify" }, { stage: "gate-cleared" }] };
    expect(classifyMerge("a", [old]).kind).toBe("unknown");
    expect(classifyMerge("b", [{ flowId: "b", history: [{ stage: "implement" }, { stage: "stopped" }] }]).kind).toBe("bypass");
  });

  it("plan 子流的 mergedBy / history 也算进 plan", () => {
    expect(classifyMerge("plan-1", [{ flowId: "child", planId: "plan-1", history: [{ stage: "gate-cleared" }] }]).kind).toBe("unknown");
    expect(classifyMerge("plan-1", [{ flowId: "plan-1", mergedBy: { by: "agent", at: 3 } }]).kind).toBe("agent");
  });
});