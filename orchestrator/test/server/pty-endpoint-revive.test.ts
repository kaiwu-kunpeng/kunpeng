import { describe, it, expect } from "vitest";
import { resolveSessionForConnection } from "../../src/server/pty-endpoint.js";

describe("resolveSessionForConnection", () => {
  it("想要的会话在池中活着 → 直接复用", async () => {
    const r = await resolveSessionForConnection(
      { wantSession: "s1", workspaceId: "ws1" },
      { aliveWorkspace: (id) => id === "s1" ? "ws1" : undefined, revive: async () => { throw new Error("不应调用"); } },
    );
    expect(r).toEqual({ id: "s1", revived: false });
  });
  it("活会话属于其他 workspace → 拒绝复用且不复活", async () => {
    const r = await resolveSessionForConnection(
      { wantSession: "s1", workspaceId: "ws2" },
      { aliveWorkspace: (id) => id === "s1" ? "ws1" : undefined, revive: async () => { throw new Error("不应调用"); } },
    );
    expect(r).toEqual({ id: undefined, revived: false, mismatch: true });
  });
  it("池中没有但 revive 成功 → 同 id 复活", async () => {
    const r = await resolveSessionForConnection(
      { wantSession: "s1", workspaceId: "ws1" },
      { aliveWorkspace: () => undefined, revive: async (id, ws) => id === "s1" && ws === "ws1" },
    );
    expect(r).toEqual({ id: "s1", revived: true });
  });
  it("revive 失败/未配置/未要求会话 → 交回新建(id undefined)", async () => {
    const a = await resolveSessionForConnection({ wantSession: "s1", workspaceId: "ws1" }, { aliveWorkspace: () => undefined, revive: async () => false });
    expect(a).toEqual({ id: undefined, revived: false });
    const b = await resolveSessionForConnection({ wantSession: "s1", workspaceId: "ws1" }, { aliveWorkspace: () => undefined });
    expect(b).toEqual({ id: undefined, revived: false });
    const c = await resolveSessionForConnection({ workspaceId: "ws1" }, { aliveWorkspace: () => "ws1" });
    expect(c).toEqual({ id: undefined, revived: false });
  });
  it("revive 抛错不炸,降级新建", async () => {
    const r = await resolveSessionForConnection(
      { wantSession: "s1", workspaceId: "ws1" },
      { aliveWorkspace: () => undefined, revive: async () => { throw new Error("tmux 不可用"); } },
    );
    expect(r).toEqual({ id: undefined, revived: false });
  });
});
