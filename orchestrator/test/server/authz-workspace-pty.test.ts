import { describe, expect, it } from "vitest";
import { authorizeRequest, capabilityForRoute, ROUTE_CAPABILITY_PATTERNS, RESTRICTED_POLICY } from "../../src/server/authz.js";
import type { AccountRecord, ParsedSession } from "../../src/server/auth.js";

const accounts = [
  { id: "a-owner", username: "admin", profileId: "home", role: "owner" },
  { id: "a-member", username: "bob", profileId: "home", role: "member" },
] as unknown as AccountRecord[];
const sess = (accountId: string): ParsedSession => ({ accountId, profileId: "home" } as unknown as ParsedSession);

describe("工作台终端端点要 terminal 能力（作者锁定）", () => {
  it("模式表先于前缀表：workspace 下的 pty 是 terminal，chat 仍是 chat", () => {
    expect(ROUTE_CAPABILITY_PATTERNS.length).toBeGreaterThanOrEqual(1);
    expect(capabilityForRoute("/api/workspace/kunpeng/pty", "GET")).toBe("terminal");
    expect(capabilityForRoute("/api/workspace/kunpeng/pty?session=s1&cols=80&rows=24", "GET")).toBe("terminal");
    expect(capabilityForRoute("/api/workspace/kunpeng/pty/sessions", "GET")).toBe("terminal");
    expect(capabilityForRoute("/api/workspace/kunpeng/chat", "POST")).toBe("chat");
    expect(capabilityForRoute("/api/workspace/kunpeng/chat/attach", "GET")).toBe("chat");
    expect(capabilityForRoute("/api/workspace/kunpeng/chat/stop", "POST")).toBe("chat");
    expect(capabilityForRoute("/api/workspace/kunpeng/ptyx", "GET")).toBe("chat");
  });

  it("受限策略下 member 碰工作台终端 403，owner 放行；member 的工作台对话仍放行", () => {
    for (const path of ["/api/workspace/kunpeng/pty", "/api/workspace/kunpeng/pty/sessions"]) {
      expect(authorizeRequest(sess("a-member"), accounts, path, RESTRICTED_POLICY, "GET")).toEqual({ ok: false, status: 403 });
      expect(authorizeRequest(sess("a-owner"), accounts, path, RESTRICTED_POLICY, "GET").ok).toBe(true);
    }
    expect(authorizeRequest(sess("a-member"), accounts, "/api/workspace/kunpeng/chat", RESTRICTED_POLICY, "POST").ok).toBe(true);
  });
});