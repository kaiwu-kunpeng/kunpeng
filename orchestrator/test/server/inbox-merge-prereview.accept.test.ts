import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preReviewMerge } from "../../src/server/pre-review.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { aggregateReviewQueue, type ProjectSnapshot } from "../../src/server/state.js";

function fakeRunner(text: string) {
  return { run: async () => ({ text }) } as unknown as Parameters<typeof preReviewMerge>[1];
}
function snap(state: unknown): ProjectSnapshot {
  return { id: "p1", name: "P", repoPath: "/tmp/p", state } as unknown as ProjectSnapshot;
}

describe("合并门 AI 预审(作者验收)", () => {
  it("preReviewMerge:解析 verdict;失败降级 review", async () => {
    const ok = await preReviewMerge("diff --git a b", fakeRunner('{"verdict":"approve","reason":"改动小"}'), () => 1);
    expect(ok.verdict).toBe("approve");
    const badRunner = {
      run: async () => { throw new Error("boom"); },
    } as unknown as Parameters<typeof preReviewMerge>[1];
    const bad = await preReviewMerge("x", badRunner, () => 1);
    expect(bad.verdict).toBe("review");
  });

  it("FlowTracker.setGatePreReview:写回并读出;无门不抛", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-flowgate-"));
    const t = new FlowTracker(dir, () => 100);
    await t.start("f1", "改登录");
    await t.finish("f1", "verified", { gate: "合并主干 kp/x → main", what: "3 文件" });
    await t.setGatePreReview("f1", { verdict: "approve", reason: "改动小", at: 1 });
    const s = await t.read("f1");
    expect(s!.humanGate!.preReview!.verdict).toBe("approve");
    await expect(t.setGatePreReview("nope", { verdict: "review", reason: "x", at: 1 })).resolves.toBeUndefined();
  });

  it("aggregateReviewQueue:merge 门透传 preReview(回归)", () => {
    const q = aggregateReviewQueue([snap({
      humanGates: [{ flowId: "g1", what: "合并到 main", detail: "d", preReview: { verdict: "reject", reason: "改了核心文件", at: 3 } }],
      flows: [], artifacts: {},
    })]);
    expect(q.find((i) => i.kind === "merge")!.preReview?.verdict).toBe("reject");
  });
});
