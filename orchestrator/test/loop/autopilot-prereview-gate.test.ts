import { describe, expect, it } from "vitest";
import { runAutopilot, type AutopilotDeps } from "../../src/loop/autopilot.js";
import { MERGE_DIFF_TRUNCATED_NOTICE, preReviewMerge } from "../../src/server/pre-review.js";

function flow(flowId: string, requirement = "把某个纯函数补个边界用例") {
  return {
    flowId,
    status: "verified",
    requirement,
    humanGate: { gate: "合并主干", what: `${flowId} → main` },
  };
}

function deps(over: Partial<AutopilotDeps> & { flows?: unknown[] } = {}): AutopilotDeps {
  const merged: string[] = [];
  const flows = over.flows ?? [flow("f1")];
  const base = {
    tracker: { list: async () => flows, markSensitive: async () => {} } as unknown as AutopilotDeps["tracker"],
    merge: async (flowId: string) => {
      merged.push(flowId);
      return { ok: true };
    },
  } as AutopilotDeps;
  return Object.assign(base, over) as AutopilotDeps;
}

describe("autopilot 遵守合并预审判决", () => {
  it("不注入 preReview 时行为不变：照常合并", async () => {
    const r = await runAutopilot(deps());
    expect(r.merged).toEqual(["f1"]);
    expect(r.skipped).toEqual([]);
  });

  it("判 reject → 不合并、进 skipped，理由带预审原文", async () => {
    const r = await runAutopilot(
      deps({ preReview: async () => ({ verdict: "reject", reason: "改动触及合并门自身且无测试" }) }),
    );
    expect(r.merged).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].flowId).toBe("f1");
    expect(r.skipped[0].reason).toContain("改动触及合并门自身且无测试");
  });

  it("判 approve → 照常合并", async () => {
    const r = await runAutopilot(deps({ preReview: async () => ({ verdict: "approve", reason: "改动小" }) }));
    expect(r.merged).toEqual(["f1"]);
  });

  it("判 review → 刻意不拦，照常合并", async () => {
    const r = await runAutopilot(deps({ preReview: async () => ({ verdict: "review", reason: "信息不足" }) }));
    expect(r.merged).toEqual(["f1"]);
  });

  it("预审返回 null → 照常合并", async () => {
    const r = await runAutopilot(deps({ preReview: async () => null }));
    expect(r.merged).toEqual(["f1"]);
  });

  it("预审抛错 → 保守保留门，不合并", async () => {
    const r = await runAutopilot(
      deps({
        preReview: async () => {
          throw new Error("runner 挂了");
        },
      }),
    );
    expect(r.merged).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toContain("runner 挂了");
  });

  it("敏感改动先被拦下，不为它付预审调用", async () => {
    let called = 0;
    const r = await runAutopilot(
      deps({
        flows: [flow("f-sensitive", "顺手改一下 constitution 里的措辞")],
        sensitive: async () => ({ hits: [{ file: "constitution/core.md", label: "宪法与角色卡" }] }),
        preReview: async () => {
          called++;
          return { verdict: "approve", reason: "ok" };
        },
      }),
    );
    expect(r.merged).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(called).toBe(0);
  });

  it("futile 的流被 discard，不为它付预审调用", async () => {
    let called = 0;
    const r = await runAutopilot(
      deps({
        futile: async () => ({ futile: true, reason: "空提交" }),
        discard: async () => {},
        preReview: async () => {
          called++;
          return { verdict: "approve", reason: "ok" };
        },
      }),
    );
    expect(r.merged).toEqual([]);
    expect(called).toBe(0);
  });
});

describe("preReviewMerge 截断显式化", () => {
  const runnerSaying = (text: string) => {
    const seen: string[] = [];
    const runner = {
      run: async (req: { system: string }) => {
        seen.push(req.system);
        return { text };
      },
    } as unknown as Parameters<typeof preReviewMerge>[1];
    return { runner, seen };
  };

  it("超长 diff：模型说 approve 也被降级为 review，理由非空", async () => {
    const huge = "diff --git a b\n" + "+x\n".repeat(40_000);
    const { runner } = runnerSaying('{"verdict":"approve","reason":"看着没问题"}');
    const pr = await preReviewMerge(huge, runner, () => 1);
    expect(pr.verdict).toBe("review");
    expect(pr.reason.length).toBeGreaterThan(0);
  });

  it("超长 diff：system 提示词里含截断告知", async () => {
    const huge = "diff --git a b\n" + "+x\n".repeat(40_000);
    const { runner, seen } = runnerSaying('{"verdict":"approve","reason":"看着没问题"}');
    await preReviewMerge(huge, runner, () => 1);
    expect(seen.join("\n")).toContain(MERGE_DIFF_TRUNCATED_NOTICE);
  });

  it("正常长度 diff：approve 仍是 approve，且不含截断告知", async () => {
    const { runner, seen } = runnerSaying('{"verdict":"approve","reason":"改动小"}');
    const pr = await preReviewMerge("diff --git a b\n+x\n", runner, () => 1);
    expect(pr.verdict).toBe("approve");
    expect(seen.join("\n")).not.toContain(MERGE_DIFF_TRUNCATED_NOTICE);
  });

  it("超长 diff 判 reject 时不受降级影响", async () => {
    const huge = "diff --git a b\n" + "+x\n".repeat(40_000);
    const { runner } = runnerSaying('{"verdict":"reject","reason":"删了守门代码"}');
    const pr = await preReviewMerge(huge, runner, () => 1);
    expect(pr.verdict).toBe("reject");
  });
});