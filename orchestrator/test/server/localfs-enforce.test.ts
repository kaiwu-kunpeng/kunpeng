import { describe, it, expect } from "vitest";
import { handleLocalFsRoute } from "../../src/server/workspace-endpoints.js";
import { createOpQueue } from "../../src/server/localfs/op-queue.js";
import { createAuthzRegistry } from "../../src/server/localfs/authz-registry.js";

const authzWith = (conv: string, clientId: string) => {
  const a = createAuthzRegistry();
  a.register({ conv, clientId, dirName: "work", origin: "h", username: "u", ts: 1 });
  return a;
};

describe("localfs P3 后端归属强制", () => {
  it("poll:登记 A,clientId=A 放行(204空队列)", async () => {
    const r = await handleLocalFsRoute(createOpQueue(), { kind: "poll", conv: "c1", clientId: "A" }, authzWith("c1", "A"));
    expect(r.status).toBe(204);
  });

  it("poll:登记 A,clientId=B → 403 且 op 不外泄", async () => {
    const q = createOpQueue();
    void q.enqueue("c1", { kind: "list", path: "" } as never, 5000).catch(() => {});
    const r = await handleLocalFsRoute(q, { kind: "poll", conv: "c1", clientId: "B" }, authzWith("c1", "A"));
    expect(r.status).toBe(403);
    expect((r.json as { reason?: string }).reason).toBe("not-owner");
    // op 仍在队列(未被 take)
    expect(q.take("c1")).toBeTruthy();
  });

  it("poll:未登记 conv → legacy 放行", async () => {
    const r = await handleLocalFsRoute(createOpQueue(), { kind: "poll", conv: "cX", clientId: "" }, createAuthzRegistry());
    expect(r.status).toBe(204);
  });

  it("result:clientId 不符 → 403 且 op 不被撤销", async () => {
    const q = createOpQueue();
    const p = q.enqueue("c1", { kind: "list", path: "" } as never, 5000);
    const op = q.take("c1")!;
    const r = await handleLocalFsRoute(q, { kind: "result", conv: "c1", clientId: "B", body: { opId: (op as { opId: string }).opId, ok: true } }, authzWith("c1", "A"));
    expect(r.status).toBe(403);
    void p.catch(() => {});
  });

  it("result:conv 不符的 opId 撤单被 op-queue 拒", async () => {
    const q = createOpQueue();
    const p = q.enqueue("cA", { kind: "list", path: "" } as never, 5000);
    const op = q.take("cA")!;
    // 用错误的 conv 传给 resolve
    expect(q.resolve((op as { opId: string }).opId, { opId: (op as { opId: string }).opId, ok: true }, { conv: "cB" })).toBe(false);
    // 正确 conv 可撤
    expect(q.resolve((op as { opId: string }).opId, { opId: (op as { opId: string }).opId, ok: true }, { conv: "cA" })).toBe(true);
    void p.catch(() => {});
  });
});