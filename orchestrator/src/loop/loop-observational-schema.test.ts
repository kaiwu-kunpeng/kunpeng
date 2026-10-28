import { describe, it, expect } from "vitest";
import { LoopDefSchema } from "./types.js";

const base = { id: "L", name: "n", projectId: "p", recipe: "geo-monitor", levers: [], waves: [], createdAt: 1, updatedAt: 1 };

describe("LoopDefSchema.metric.observational", () => {
  it("接受带 observational 的指标声明", () => {
    const parsed = LoopDefSchema.parse({ ...base, metric: { key: "mentions", label: "AI 提及数", current: 0, observational: true } });
    expect(parsed.metric.observational).toBe(true);
  });

  it("旧 JSON(无该字段)继续通过校验", () => {
    const parsed = LoopDefSchema.parse({ ...base, metric: { key: "mentions", label: "AI 提及数", current: 0 } });
    expect(parsed.metric.observational).toBeUndefined();
  });
});