import { describe, it, expect } from "vitest";
import { describeSkippedStateFile, migrateFlowState } from "../../src/runtime/flowstate.js";

describe("describeSkippedStateFile", () => {
  it("非流形状（顶层数组，如 maintenance-ledger.json）→ 措辞是「非流状态文件」且不拼原始错误", () => {
    let caught: unknown;
    try {
      migrateFlowState([{ any: "thing" }]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TypeError);
    const msg = describeSkippedStateFile("/s/maintenance-ledger.json", caught);
    expect(msg).toBe("[flowstate] 非流状态文件，已跳过：/s/maintenance-ledger.json");
    expect(msg).not.toContain("损坏");
    expect(msg).not.toContain("Invalid FlowState");
  });

  it("真损坏（JSON 解析失败）→ 保持「损坏」措辞并附原始错误", () => {
    const err = new SyntaxError("Unexpected end of JSON input");
    const msg = describeSkippedStateFile("/s/flow-abc.json", err);
    expect(msg).toBe(
      "[flowstate] 流状态文件损坏，已跳过：/s/flow-abc.json — SyntaxError: Unexpected end of JSON input",
    );
  });

  it("null 也属非流形状 → 走「非流状态文件」分支", () => {
    let caught: unknown;
    try {
      migrateFlowState(null);
    } catch (e) {
      caught = e;
    }
    expect(describeSkippedStateFile("/s/x.json", caught)).toBe(
      "[flowstate] 非流状态文件，已跳过：/s/x.json",
    );
  });
});