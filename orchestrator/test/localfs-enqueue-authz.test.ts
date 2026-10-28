import { describe, expect, test, vi } from "vitest";

import type { AuthzRegistry } from "../src/server/localfs/authz-registry.js";
import type { OpQueue } from "../src/server/localfs/op-queue.js";
import type { LocalFsOp, LocalFsResult } from "../src/server/localfs/types.js";
import { handleLocalFsRoute } from "../src/server/workspace-endpoints.js";

function createAuthz(allowed: boolean): AuthzRegistry {
  return {
    register: () => {},
    get: () => ({
      conv: "conv-1",
      clientId: "owner-client",
      dirName: "workspace",
      origin: "https://example.test",
      username: "owner",
      ts: 1,
    }),
    matches: () => allowed,
    clear: () => {},
  };
}

function createQueue(taken: LocalFsOp | null = null): {
  queue: OpQueue;
  enqueue: ReturnType<typeof vi.fn>;
  take: ReturnType<typeof vi.fn>;
} {
  const enqueue = vi.fn(async (): Promise<LocalFsResult> => ({ opId: "op-1", ok: true }));
  const take = vi.fn(() => taken);
  return {
    enqueue,
    take,
    queue: {
      enqueue,
      take,
      resolve: () => false,
    },
  };
}

describe("localfs enqueue authorization", () => {
  test("unauthorized enqueue returns 403 before queue.enqueue", async () => {
    const { queue, enqueue } = createQueue();

    const response = await handleLocalFsRoute(
      queue,
      {
        kind: "enqueue",
        conv: "conv-1",
        clientId: "attacker-client",
        body: { kind: "delete", path: "private.txt" },
      },
      createAuthz(false),
    );

    expect(response.status).toBe(403);
    expect(response.json).toMatchObject({ ok: false, reason: "not-owner" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("authorized enqueue remains unchanged", async () => {
    const { queue, enqueue } = createQueue();

    const response = await handleLocalFsRoute(
      queue,
      {
        kind: "enqueue",
        conv: "conv-1",
        body: { kind: "read", path: "allowed.txt" },
      },
      createAuthz(true),
    );

    expect(response).toEqual({ status: 200, json: { opId: "op-1", ok: true } });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      "conv-1",
      { kind: "read", path: "allowed.txt" },
      120_000,
      8_000,
    );
  });

  test("poll authorization behavior is unchanged", async () => {
    const op: LocalFsOp = {
      opId: "op-poll",
      conv: "conv-1",
      kind: "read",
      path: "queued.txt",
    };
    const denied = createQueue(op);
    const allowed = createQueue(op);

    const deniedResponse = await handleLocalFsRoute(
      denied.queue,
      { kind: "poll", conv: "conv-1", clientId: "attacker-client" },
      createAuthz(false),
    );
    const allowedResponse = await handleLocalFsRoute(
      allowed.queue,
      { kind: "poll", conv: "conv-1", clientId: "owner-client" },
      createAuthz(true),
    );

    expect(deniedResponse.status).toBe(403);
    expect(deniedResponse.json).toMatchObject({ ok: false, reason: "not-owner" });
    expect(denied.take).not.toHaveBeenCalled();
    expect(allowedResponse).toEqual({ status: 200, json: op });
    expect(allowed.take).toHaveBeenCalledTimes(1);
  });
});
