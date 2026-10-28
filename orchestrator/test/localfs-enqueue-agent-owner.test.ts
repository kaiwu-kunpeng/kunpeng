import { describe, expect, test, vi } from "vitest";

import { createAuthzRegistry } from "../src/server/localfs/authz-registry.js";
import type { OpQueue } from "../src/server/localfs/op-queue.js";
import type { LocalFsResult } from "../src/server/localfs/types.js";
import { handleLocalFsRoute } from "../src/server/workspace-endpoints.js";

function mockQueue(): { queue: OpQueue; enqueue: ReturnType<typeof vi.fn> } {
  const enqueue = vi.fn(async (): Promise<LocalFsResult> => ({ opId: "op-1", ok: true }));
  return { queue: { enqueue, take: () => null, resolve: () => false }, enqueue };
}

function registryWithOwner() {
  const a = createAuthzRegistry();
  a.register({ conv: "c1", clientId: "browser-A", dirName: "用增", origin: "https://cockpit.test", username: "admin", ts: 1 });
  return a;
}

describe("localfs enqueue:agent 按 conv+username 归属,而非浏览器 clientId", () => {
  test("已授权 conv,无 clientId 但 username 匹配 → 200 放行", async () => {
    const { queue, enqueue } = mockQueue();
    const r = await handleLocalFsRoute(
      queue,
      { kind: "enqueue", conv: "c1", username: "admin", body: { kind: "list", path: "" } },
      registryWithOwner(),
    );
    expect(r.status).toBe(200);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  test("已授权 conv,username 不匹配 → 403 not-owner 且不入队", async () => {
    const { queue, enqueue } = mockQueue();
    const r = await handleLocalFsRoute(
      queue,
      { kind: "enqueue", conv: "c1", username: "intruder", body: { kind: "read", path: "a.txt" } },
      registryWithOwner(),
    );
    expect(r.status).toBe(403);
    expect((r.json as { reason?: string }).reason).toBe("not-owner");
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("未登记 conv → 维持 legacy 放行", async () => {
    const { queue } = mockQueue();
    const r = await handleLocalFsRoute(
      queue,
      { kind: "enqueue", conv: "cX", username: "admin", body: { kind: "list", path: "" } },
      createAuthzRegistry(),
    );
    expect(r.status).toBe(200);
  });

  test("poll 归属仍按 clientId:错 clientId → 403", async () => {
    const { queue } = mockQueue();
    const r = await handleLocalFsRoute(
      queue,
      { kind: "poll", conv: "c1", clientId: "attacker" },
      registryWithOwner(),
    );
    expect(r.status).toBe(403);
  });
});