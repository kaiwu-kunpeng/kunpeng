import { describe, expect, test } from "vitest";
import { recordValidation } from "./validation-record.js";
import type { ShapedPitch, ProductValidationSignal } from "./contract.js";

const pitch: ShapedPitch = {
  title: "测试产品",
  appetite: "6 weeks",
  problem: "用户找不到合适信号源",
  solution: "聚合多来源信号 dashboard",
  buildScope: ["信号采集", "dashboard 展示"],
  rabbitHoles: ["历史数据回填"],
  noGos: ["第三方 CRM 接入"],
  successMetrics: ["DAU > 100", "信号采集率 > 80%"],
};

describe("recordValidation", () => {
  test("真实信号 + persevere → iteration.action=build", () => {
    const signals: ProductValidationSignal[] = [
      { source: "用户访谈", kind: "interview", summary: "10人愿付费", synthetic: false },
    ];
    const r = recordValidation({ pitch, hypotheses: ["用户愿付费"], signals, decision: "persevere" });
    expect(r.validation.decision).toBe("persevere");
    expect(r.iteration.action).toBe("build");
  });

  test("只有合成信号 → 强制 inconclusive，action=gather-signals", () => {
    const signals: ProductValidationSignal[] = [
      { source: "假想", kind: "other", summary: "x", synthetic: true },
    ];
    const r = recordValidation({ pitch, hypotheses: ["h"], signals, decision: "persevere" });
    expect(r.validation.decision).toBe("inconclusive");
    expect(r.iteration.action).toBe("gather-signals");
  });

  test("真实信号 + pivot → action=pivot 带 nextSeed", () => {
    const signals: ProductValidationSignal[] = [
      { source: "遥测", kind: "telemetry", summary: "留存崩", synthetic: false },
    ];
    const r = recordValidation({
      pitch,
      hypotheses: ["留存假设"],
      signals,
      decision: "pivot",
      rationale: "问题选错",
    });
    expect(r.iteration.action).toBe("pivot");
    expect(r.iteration.nextSeed).toBeTruthy();
  });
});
