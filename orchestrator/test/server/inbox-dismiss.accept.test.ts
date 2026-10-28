import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InboxDismissStore } from "../../src/server/inbox-dismiss-store.js";
import { aggregateReviewQueue, type ProjectSnapshot } from "../../src/server/state.js";

function snap(state: unknown): ProjectSnapshot {
  return { id: "p1", name: "项目一", repoPath: "/tmp/p1", state } as unknown as ProjectSnapshot;
}

describe("收件箱一键忽略(作者验收)", () => {
  it("markDismissed 后 getDismissed 含键", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-dismiss-"));
    const store = new InboxDismissStore(join(dir, "inbox-dismissed.json"));
    await store.markDismissed(["failed:f1", "blocked:b2"]);
    const got = await store.getDismissed();
    expect(got.has("failed:f1")).toBe(true);
    expect(got.has("blocked:b2")).toBe(true);
  });

  it("跳过非法键,合法键仍写入", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-dismiss2-"));
    const store = new InboxDismissStore(join(dir, "inbox-dismissed.json"));
    await store.markDismissed(["nocolon", ":leadhead", "trailtail:", "", "failed:ok"]);
    const got = await store.getDismissed();
    expect(got.has("failed:ok")).toBe(true);
    expect(got.has("nocolon")).toBe(false);
    expect(got.has(":leadhead")).toBe(false);
    expect(got.has("trailtail:")).toBe(false);
  });

  it("aggregateReviewQueue 过滤被忽略的 failed 条目,其它保留", () => {
    const now = 1_000_000_000_000;
    const q = aggregateReviewQueue([snap({ humanGates: [], artifacts: {}, flows: [
      { flowId: "old", requirement: "被忽略停流", status: "stopped", updatedAt: now - 1000 },
      { flowId: "keep", requirement: "保留停流", status: "stopped", updatedAt: now - 1000 },
    ] })], { now, dismissed: new Set(["failed:old"]) });
    const failed = q.filter((i) => i.kind === "failed");
    expect(failed.some((i) => i.id === "old")).toBe(false);
    expect(failed.some((i) => i.id === "keep")).toBe(true);
  });

  it("不传 dismissed 不过滤", () => {
    const now = 1_000_000_000_000;
    const q = aggregateReviewQueue([snap({ humanGates: [], artifacts: {}, flows: [
      { flowId: "old", requirement: "停流", status: "stopped", updatedAt: now - 1000 },
    ] })], { now });
    expect(q.filter((i) => i.kind === "failed").some((i) => i.id === "old")).toBe(true);
  });

  it("dismissed 含 blocked 键时过滤对应 blocked 条目", () => {
    const now = 1_000_000_000_000;
    const q = aggregateReviewQueue([snap({ humanGates: [], artifacts: {}, flows: [],
      blockers: [{ flowId: "b1", reason: "等输入", stage: "implement" }] })],
      { now, dismissed: new Set(["blocked:b1"]) });
    expect(q.filter((i) => i.kind === "blocked").length).toBe(0);
  });
});
