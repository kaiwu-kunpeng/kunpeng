import { describe, it, expect } from "vitest";
import { createAuthzRegistry } from "../../src/server/localfs/authz-registry.js";

const entry = (conv: string, clientId: string) => ({ conv, clientId, dirName: "work", origin: "h", username: "u", ts: 1 });

describe("localfs authz-registry", () => {
  it("register → get 往返", () => {
    const r = createAuthzRegistry();
    r.register(entry("c1", "A"));
    expect(r.get("c1")?.clientId).toBe("A");
    expect(r.get("nope")).toBeUndefined();
  });

  it("matches 三分支(未登记legacy放行/相等/不等)", () => {
    const r = createAuthzRegistry();
    expect(r.matches("c1", "A")).toBe(true); // 未登记 → legacy 放行
    r.register(entry("c1", "A"));
    expect(r.matches("c1", "A")).toBe(true);
    expect(r.matches("c1", "B")).toBe(false);
    expect(r.matches("c1", "")).toBe(false); // 已登记但空 clientId 拒
  });

  it("strict 模式下未登记也拒绝", () => {
    const r = createAuthzRegistry(500, true);
    expect(r.matches("c1", "A")).toBe(false);
  });

  it("clear 后回到未登记语义", () => {
    const r = createAuthzRegistry();
    r.register(entry("c1", "A"));
    r.clear("c1");
    expect(r.get("c1")).toBeUndefined();
    expect(r.matches("c1", "anything")).toBe(true);
  });

  it("超上限 LRU 淘汰最早", () => {
    const r = createAuthzRegistry(2);
    r.register(entry("c1", "A")); r.register(entry("c2", "B")); r.register(entry("c3", "C"));
    expect(r.get("c1")).toBeUndefined();
    expect(r.get("c2")?.clientId).toBe("B");
    expect(r.get("c3")?.clientId).toBe("C");
  });

  it("同 conv 覆盖", () => {
    const r = createAuthzRegistry();
    r.register(entry("c1", "A")); r.register(entry("c1", "Z"));
    expect(r.get("c1")?.clientId).toBe("Z");
  });
});