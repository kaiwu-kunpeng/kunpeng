import { describe, it, expect } from "vitest";
import {
  KNOWN_NON_FLOW_STATE_FILES,
  classifyStateObject,
  shouldWarnAboutStateFile,
} from "../../src/objects/state-kinds.js";

describe("classifyStateObject", () => {
  it("带 flowId 的对象是 flow", () => {
    expect(classifyStateObject("/s/anything.json", { flowId: "f-1", status: "verified" })).toEqual({
      kind: "flow",
      isFlow: true,
      known: true,
    });
  });

  it("维护台账被判为 ledger", () => {
    expect(classifyStateObject("/s/maintenance-ledger.json", [{ id: "a" }])).toEqual({
      kind: "ledger",
      isFlow: false,
      known: true,
    });
  });

  it("两份基线都被判为 baseline", () => {
    expect(classifyStateObject("/s/fitness-baseline.json", { netSavedHours: 1 })).toEqual({
      kind: "baseline",
      isFlow: false,
      known: true,
    });
    expect(classifyStateObject("/s/product-kpi-baseline.json", { key: "autonomy" })).toEqual({
      kind: "baseline",
      isFlow: false,
      known: true,
    });
  });

  it("按 basename 判定，带目录前缀也认得出来", () => {
    const c = classifyStateObject("/a/b/c/.kunpeng/state/maintenance-ledger.json");
    expect(c.kind).toBe("ledger");
    expect(c.known).toBe(true);
  });

  it("陌生文件是 unknown 且 known 为假", () => {
    expect(classifyStateObject("/s/whatever.json", { a: 1 })).toEqual({
      kind: "unknown",
      isFlow: false,
      known: false,
    });
  });

  it("数组顶层不会被误判成 flow", () => {
    expect(classifyStateObject("/s/whatever.json", [{ flowId: "f-1" }]).isFlow).toBe(false);
  });

  it("null 与 undefined 不会被误判成 flow", () => {
    expect(classifyStateObject("/s/whatever.json", null).isFlow).toBe(false);
    expect(classifyStateObject("/s/whatever.json").isFlow).toBe(false);
  });

  it("flowId 不是字符串时不算 flow", () => {
    expect(classifyStateObject("/s/whatever.json", { flowId: 42 }).isFlow).toBe(false);
  });

  it("已知非流文件即使内容带 flowId 也优先按 flow 判（flowId 判定在前）", () => {
    expect(classifyStateObject("/s/maintenance-ledger.json", { flowId: "f-9" }).kind).toBe("flow");
  });
});

describe("KNOWN_NON_FLOW_STATE_FILES", () => {
  it("恰好登记三项，且映射正确", () => {
    expect(Object.keys(KNOWN_NON_FLOW_STATE_FILES).sort()).toEqual([
      "fitness-baseline.json",
      "maintenance-ledger.json",
      "product-kpi-baseline.json",
    ]);
    expect(KNOWN_NON_FLOW_STATE_FILES["maintenance-ledger.json"]).toBe("ledger");
    expect(KNOWN_NON_FLOW_STATE_FILES["fitness-baseline.json"]).toBe("baseline");
    expect(KNOWN_NON_FLOW_STATE_FILES["product-kpi-baseline.json"]).toBe("baseline");
  });
});

describe("shouldWarnAboutStateFile", () => {
  it("三个已知非流文件都不该再报警", () => {
    expect(shouldWarnAboutStateFile("/s/maintenance-ledger.json")).toBe(false);
    expect(shouldWarnAboutStateFile("/s/fitness-baseline.json")).toBe(false);
    expect(shouldWarnAboutStateFile("/s/product-kpi-baseline.json")).toBe(false);
  });

  it("陌生文件仍然要报警", () => {
    expect(shouldWarnAboutStateFile("/s/mystery.json")).toBe(true);
  });

  it("flow 文件不报警", () => {
    expect(shouldWarnAboutStateFile("/s/f.json", { flowId: "f-1" })).toBe(false);
  });
});