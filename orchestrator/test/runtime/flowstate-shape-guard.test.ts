import { describe, it, expect } from "vitest";
import {
  isFlowStateShape,
  migrateFlowState,
  describeSkippedStateFile,
  FLOWSTATE_SCHEMA_VERSION,
} from "../../src/runtime/flowstate.js";

describe("isFlowStateShape", () => {
  it("带非空字符串 flowId 的对象 → true", () => {
    expect(isFlowStateShape({ flowId: "loop-demo-catalog-w61", status: "verified" })).toBe(true);
  });

  it("缺 flowId 的对象（真实 fitness-baseline.json 形状）→ false", () => {
    expect(isFlowStateShape({ generatedAt: 1785548089186, escapeRate: 0.12 })).toBe(false);
  });

  it("缺 flowId 的对象（真实 model-expand loop 快照形状）→ false", () => {
    expect(isFlowStateShape({ enum_value: "BLOWER_MOTOR", status: "done", wave: 78 })).toBe(false);
  });

  it("flowId 为空串 → false", () => {
    expect(isFlowStateShape({ flowId: "" })).toBe(false);
  });

  it("flowId 非字符串 → false", () => {
    expect(isFlowStateShape({ flowId: 123 })).toBe(false);
  });

  it("null / 数组 / 原始值 → false", () => {
    expect(isFlowStateShape(null)).toBe(false);
    expect(isFlowStateShape([{ flowId: "f1" }])).toBe(false);
    expect(isFlowStateShape("flowId")).toBe(false);
    expect(isFlowStateShape(7)).toBe(false);
  });
});

describe("migrateFlowState 形状门", () => {
  it("缺 flowId 的对象 → 抛 TypeError 且消息含 Invalid FlowState", () => {
    let caught: unknown;
    try {
      migrateFlowState({ generatedAt: 1785548089186 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).message).toContain("Invalid FlowState");
  });

  it("被拒的非流文件 → describeSkippedStateFile 走「非流状态文件」分支", () => {
    let caught: unknown;
    try {
      migrateFlowState({ enum_value: "BLOWER_MOTOR" });
    } catch (e) {
      caught = e;
    }
    expect(describeSkippedStateFile("/s/loop-demo-model-expand-BLOWER_MOTOR.json", caught)).toBe(
      "[flowstate] 非流状态文件，已跳过：/s/loop-demo-model-expand-BLOWER_MOTOR.json",
    );
  });

  it("带合法 flowId 的旧流仍被放行、补版本号且不丢字段", () => {
    const legacy = {
      flowId: "loop-demo-catalog-w61",
      requirement: "r",
      stage: "done",
      status: "rolled-back",
      agentActive: false,
      startedAt: 1,
      updatedAt: 2,
      history: [],
      tokensUsed: 42,
    };
    const out = migrateFlowState(legacy);
    expect(out.schemaVersion).toBe(FLOWSTATE_SCHEMA_VERSION);
    expect(out.flowId).toBe("loop-demo-catalog-w61");
    expect(out.status).toBe("rolled-back");
    expect((out as unknown as { tokensUsed: number }).tokensUsed).toBe(42);
  });
});