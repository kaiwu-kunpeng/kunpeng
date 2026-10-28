import { describe, it, expect } from "vitest";
import { migrateConversation, CONVERSATION_SCHEMA_VERSION } from "./conversation-store.js";

describe("migrateConversation", () => {
  it("给无版本号的旧会话补上当前版本号", () => {
    const legacy = { id: "c1", title: "t", model: "m", updatedAt: 1, turns: [] };
    const out = migrateConversation(legacy);
    expect(out.schemaVersion).toBe(CONVERSATION_SCHEMA_VERSION);
    expect(out.id).toBe("c1");
    expect(Array.isArray(out.turns)).toBe(true);
  });
  it("保留已有当前版本号且不丢 turns", () => {
    const cur = { id: "c2", title: "t", model: "m", updatedAt: 2, turns: [{ role: "user", content: "hi" }], schemaVersion: CONVERSATION_SCHEMA_VERSION };
    const out = migrateConversation(cur);
    expect(out.schemaVersion).toBe(CONVERSATION_SCHEMA_VERSION);
    expect(out.turns.length).toBe(1);
  });
});