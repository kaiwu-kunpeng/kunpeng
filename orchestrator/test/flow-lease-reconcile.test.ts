import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { reconcileDeadFlows } from "../src/runtime/reconcile.js";

const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }).catch(() => {}); });
async function freshTracker(): Promise<{ tracker: FlowTracker; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "kp-lease-"));
  dirs.push(dir);
  return { tracker: new FlowTracker(dir), dir };
}

describe("flow 心跳租约收尸", () => {
  it("renewLease 后 lease.renewedAt 单调递增", async () => {
    const { tracker } = await freshTracker();
    await tracker.start("f1", "需求");
    await tracker.renewLease("f1", 120000);
    const a = (await tracker.read("f1"))!.lease!.renewedAt;
    await tracker.renewLease("f1", 120000);
    const b = (await tracker.read("f1"))!.lease!.renewedAt;
    expect(b).toBeGreaterThanOrEqual(a);
    expect((await tracker.read("f1"))!.lease!.ttlMs).toBe(120000);
  });

  it("租约过期(超 2×ttl)且 pid 不可判时,running 流被判 crashed 且 reason 含 lease-expired", async () => {
    const { tracker } = await freshTracker();
    await tracker.start("f2", "需求");
    await tracker.renewLease("f2", 1000);
    const now = () => Date.now() + 10_000; // 远超 2×1000ms
    await reconcileDeadFlows(tracker, { isAlive: () => false, now });
    const s = (await tracker.read("f2"))!;
    expect(s.status).toBe("crashed");
    expect(JSON.stringify(s)).toContain("lease-expired");
  });

  it("租约新鲜的 running 流不被收尸", async () => {
    const { tracker } = await freshTracker();
    await tracker.start("f3", "需求");
    await tracker.renewLease("f3", 120000);
    await reconcileDeadFlows(tracker, { isAlive: () => false, now: () => Date.now() });
    expect((await tracker.read("f3"))!.status).toBe("running");
  });
});
