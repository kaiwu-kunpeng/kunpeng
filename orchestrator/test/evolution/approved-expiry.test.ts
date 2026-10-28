import { expect, test, vi } from "vitest";
import {
  APPROVED_EXPIRED_REASON,
  APPROVED_EXPIRY_DAYS,
  expireStaleApproved,
  isApprovedExpired,
} from "../../src/evolution/approved-expiry.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 18, 0, 0, 0);

function fakeStore(rows: Array<{ id: string; status: string; meta?: Record<string, unknown> }>) {
  const state = new Map(rows.map((r) => [r.id, { kind: "proposal", id: r.id, status: r.status, body: "", meta: r.meta ?? {} }]));
  const patched: Array<[string, Record<string, unknown>]> = [];
  const transitions: Array<[string, string]> = [];
  return {
    patched,
    transitions,
    store: {
      list: async (_kind: "proposal") => [...state.values()],
      patchMeta: async (id: string, meta: Record<string, unknown>) => {
        patched.push([id, meta]);
        const cur = state.get(id)!;
        cur.meta = { ...cur.meta, ...meta };
        return cur;
      },
      transition: async (id: string, to: string) => {
        transitions.push([id, to]);
        const cur = state.get(id)!;
        if (to === "rolled-back" && cur.status !== "approved") throw new Error(`illegal transition: ${cur.status} -> ${to}`);
        cur.status = to;
        return cur;
      },
    },
    state,
  };
}

test("常量：30 天 · 退回原因文案固定", () => {
  expect(APPROVED_EXPIRY_DAYS).toBe(30);
  expect(APPROVED_EXPIRED_REASON).toBe("approved 超 30 天未落地，自动退回");
});

test("isApprovedExpired：只看 approved 且超过 30 天；恰好 30 天不算", () => {
  expect(isApprovedExpired({ status: "approved" }, { nowMs: NOW, anchorMs: NOW - 31 * DAY })).toBe(true);
  expect(isApprovedExpired({ status: "approved" }, { nowMs: NOW, anchorMs: NOW - 30 * DAY })).toBe(false);
  expect(isApprovedExpired({ status: "approved" }, { nowMs: NOW, anchorMs: NOW - 1 * DAY })).toBe(false);
  expect(isApprovedExpired({ status: "draft" }, { nowMs: NOW, anchorMs: NOW - 400 * DAY })).toBe(false);
  expect(isApprovedExpired({ status: "in-progress" }, { nowMs: NOW, anchorMs: NOW - 400 * DAY })).toBe(false);
});

test("expireStaleApproved：过期 approved → meta 写 humanDecision/expiredAt/expiredReason 再转 rolled-back，日志一行；其余不动", async () => {
  const f = fakeStore([
    { id: "stale-a", status: "approved" },
    { id: "fresh-b", status: "approved" },
    { id: "old-draft", status: "draft" },
    { id: "old-done", status: "verified" },
  ]);
  const mtimes: Record<string, number> = {
    "stale-a": NOW - 68 * DAY,
    "fresh-b": NOW - 2 * DAY,
    "old-draft": NOW - 200 * DAY,
    "old-done": NOW - 200 * DAY,
  };
  const log = vi.fn();
  const result = await expireStaleApproved(f.store, { nowMs: NOW, mtimeOf: async (id) => mtimes[id]!, log });

  expect(result.expired).toEqual(["stale-a"]);
  expect(f.transitions).toEqual([["stale-a", "rolled-back"]]);
  expect(f.patched).toHaveLength(1);
  const [id, meta] = f.patched[0]!;
  expect(id).toBe("stale-a");
  expect(meta.humanDecision).toBe("expired");
  expect(meta.expiredReason).toBe(APPROVED_EXPIRED_REASON);
  expect(meta.expiredAt).toBe(new Date(NOW).toISOString());
  expect(f.state.get("stale-a")!.status).toBe("rolled-back");
  expect(f.state.get("fresh-b")!.status).toBe("approved");
  expect(f.state.get("old-draft")!.status).toBe("draft");
  expect(log).toHaveBeenCalledTimes(1);
  expect(String(log.mock.calls[0]![0])).toContain("stale-a");
  expect(String(log.mock.calls[0]![0])).toContain("自动退回");
  expect(String(log.mock.calls[0]![0])).toContain("68");
});

test("expireStaleApproved：单条失败不中断整批，失败项不计入 expired", async () => {
  const f = fakeStore([
    { id: "stale-a", status: "approved" },
    { id: "stale-b", status: "approved" },
  ]);
  const log = vi.fn();
  const result = await expireStaleApproved(f.store, {
    nowMs: NOW,
    mtimeOf: async (id) => { if (id === "stale-a") throw new Error("stat failed"); return NOW - 40 * DAY; },
    log,
  });
  expect(result.expired).toEqual(["stale-b"]);
  expect(f.state.get("stale-a")!.status).toBe("approved");
  expect(f.state.get("stale-b")!.status).toBe("rolled-back");
});