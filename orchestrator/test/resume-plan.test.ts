import { describe, expect, test } from "vitest";
import { deriveCompletedStages, planFlowResume, DEV_CYCLE_STAGES } from "../src/runtime/resume-plan.js";

describe("resume-plan：从 history 推导可跳过阶段（接线 idempotent.resumeFrom）", () => {
  test("spec 后已进入 implement → spec 判为已完成、可跳过", () => {
    const history = [{ stage: "spec", at: 1 }, { stage: "audit", at: 2 }, { stage: "implement", at: 3 }];
    expect(deriveCompletedStages({ history })).toContain("spec");
  });

  test("只到 spec（history 末尾就是 spec）→ spec 未完成、不跳过", () => {
    const history = [{ stage: "spec", at: 1 }];
    expect(deriveCompletedStages({ history })).not.toContain("spec");
  });

  test("planFlowResume：跳过已完成、next 指向第一个未完成", () => {
    const history = [{ stage: "spec", at: 1 }, { stage: "implement", at: 2 }];
    const plan = planFlowResume({ history }, [...DEV_CYCLE_STAGES]);
    expect(plan.skip).toContain("spec");
    expect(plan.next).toBe("implement");
    expect(plan.done).toBe(false);
  });

  test("crashed 等非主链标记不算阶段，但其前的真实阶段仍判完成", () => {
    const history = [{ stage: "spec", at: 1 }, { stage: "implement", at: 2 }, { stage: "crashed", at: 3 }];
    const completed = deriveCompletedStages({ history });
    expect(completed).not.toContain("crashed");
    expect(completed).toContain("spec");
  });

  test("空 history → 无已完成阶段、规划从头跑", () => {
    const plan = planFlowResume({ history: [] }, [...DEV_CYCLE_STAGES]);
    expect(plan.skip).toEqual([]);
    expect(plan.next).toBe("spec");
  });
});