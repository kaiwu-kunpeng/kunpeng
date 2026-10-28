import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendGateDecision, readGateDecisions } from "../src/verify/gate-log.js";
import { FlowTracker } from "../src/runtime/flowstate.js";

describe("失败原因与门判决落盘(作者验收)", () => {
  it("门判决追加 JSONL 且可读回,坏行跳过", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-gate-"));
    appendGateDecision(dir, { at: 1, flowId: "f1", cmd: "npx vitest run a", regressions: ["t1 失败"], verdict: "fail" });
    appendGateDecision(dir, { at: 2, flowId: "f1", cmd: "npx vitest run a", regressions: [], verdict: "pass" });
    const all = readGateDecisions(dir);
    expect(all.length).toBe(2);
    expect(all[0].verdict).toBe("fail");
    expect(all[0].regressions[0]).toContain("t1");
    expect(all[1].verdict).toBe("pass");
  });

  it("写失败静默(不存在的深路径不抛)", () => {
    expect(() =>
      appendGateDecision("/nonexistent/kp-nowhere/deep", { at: 1, flowId: "f", cmd: "c", regressions: [], verdict: "pass" }),
    ).not.toThrow();
  });

  it("rolled-back 带 reason 落盘 failureReason,verified 不写", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-fr-"));
    const t = new FlowTracker(dir);
    await t.start("f1", "r");
    await t.finish("f1", "rolled-back", undefined, "verify 阶段验收未过: 测试 x 红");
    const raw = JSON.parse(await readFile(join(dir, "f1.json"), "utf8")) as { failureReason?: string };
    expect(raw.failureReason).toContain("verify");
    await t.start("f2", "r");
    await t.finish("f2", "verified");
    const raw2 = JSON.parse(await readFile(join(dir, "f2.json"), "utf8")) as { failureReason?: string };
    expect(raw2.failureReason).toBeUndefined();
  });
});
