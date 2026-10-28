import { describe, expect, test, vi } from "vitest";
import { handleLocalFsRoute } from "../workspace-endpoints.js";
import { createOpQueue, type OpQueue } from "./op-queue.js";
import type { LocalFsOp, LocalFsResult } from "./types.js";

function expectLocalFsOp(value: unknown): asserts value is LocalFsOp {
  expect(value).toMatchObject({ kind: "read", path: "a.txt" });
  expect(typeof (value as { opId?: unknown }).opId).toBe("string");
}

// handleLocalFsRoute(queue, {kind, conv, body}) -> {status, json}
describe("localfs endpoints", () => {
  test("poll 空队列返回 204", async () => {
    const q = createOpQueue();
    const r = await handleLocalFsRoute(q, { kind: "poll", conv: "c1" });
    expect(r.status).toBe(204);
  });

  test("enqueue 入队后 poll 能取到，result 解除阻塞", async () => {
    const q = createOpQueue();
    const enq = handleLocalFsRoute(q, {
      kind: "enqueue",
      conv: "c1",
      body: { kind: "read", path: "a.txt" },
    });
    const polled = await handleLocalFsRoute(q, { kind: "poll", conv: "c1" });
    expect(polled.status).toBe(200);
    expectLocalFsOp(polled.json);
    const op = polled.json;
    expect(op.kind).toBe("read");
    await handleLocalFsRoute(q, {
      kind: "result",
      conv: "c1",
      body: { opId: op.opId, ok: true, data: "HELLO" },
    });
    const final = await enq;
    expect(final.json).toMatchObject({ ok: true, data: "HELLO" });
  });

  test("enqueue 用 120s 超时(覆盖浏览器后台标签页定时器节流,默认 30s 会全部超时)", async () => {
    let seenTimeout: number | undefined;
    const q: OpQueue = {
      enqueue: async (_conv, _op, timeoutMs) => {
        seenTimeout = timeoutMs;
        return { opId: "op-1", ok: true } satisfies LocalFsResult;
      },
      take: () => null,
      resolve: () => false,
    };
    await handleLocalFsRoute(q, { kind: "enqueue", conv: "c1", body: { kind: "write", path: "a.txt", content: "x" } });
    expect(seenTimeout).toBe(120_000);
  });

  test("poll 命中即 markPolled(conv)（授权通过后）", async () => {
    const q = createOpQueue();
    const spy = vi.spyOn(q, "markPolled");
    await handleLocalFsRoute(q, { kind: "poll", conv: "c1" });
    expect(spy).toHaveBeenCalledWith("c1");
  });

  test("enqueue 以 8s noListenerMs 入队：无 poll 时 8s 内 fail-fast，回执 200+ok:false 且文案含未授权", async () => {
    vi.useFakeTimers();
    const q = createOpQueue();
    const p = handleLocalFsRoute(q, { kind: "enqueue", conv: "c9", body: { kind: "read", path: "a" } });
    await vi.advanceTimersByTimeAsync(8_100);
    const res = await p;
    expect(res.status).toBe(200);
    const j = res.json as { ok: boolean; error?: string };
    expect(j.ok).toBe(false);
    expect(j.error).toContain("未授权或需恢复");
    vi.useRealTimers();
  });
});