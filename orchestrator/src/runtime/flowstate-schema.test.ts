import { describe, it, expect } from "vitest";
import { migrateFlowState, FLOWSTATE_SCHEMA_VERSION } from "./flowstate.js";

describe("migrateFlowState", () => {
  it("给无版本号的旧 FlowState 补上当前版本号", () => {
    const legacy = { flowId: "f1", requirement: "r", stage: "spec", status: "running", agentActive: false, startedAt: 1, updatedAt: 1, history: [] };
    const out = migrateFlowState(legacy);
    expect(out.schemaVersion).toBe(FLOWSTATE_SCHEMA_VERSION);
    expect(out.flowId).toBe("f1");
    expect(out.status).toBe("running");
  });
  it("保留已存在的当前版本号且不丢字段", () => {
    const cur = { flowId: "f2", requirement: "r", stage: "verify", status: "verified", agentActive: false, startedAt: 1, updatedAt: 2, history: [], schemaVersion: FLOWSTATE_SCHEMA_VERSION, tokensUsed: 42 };
    const out = migrateFlowState(cur);
    expect(out.schemaVersion).toBe(FLOWSTATE_SCHEMA_VERSION);
    expect(out.tokensUsed).toBe(42);
  });
});