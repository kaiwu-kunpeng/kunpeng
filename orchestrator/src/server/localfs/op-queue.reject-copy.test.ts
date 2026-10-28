import { describe, expect, it } from "vitest";

import { createOpQueue } from "./op-queue.js";

async function rejectionOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected rejection");
}

describe("localfs op-queue:无页面轮询时的拒绝文案分流", () => {
  it("已授权(hasAuthz=true)但无轮询:提示切回前台,不得出现『未授权』", async () => {
    const q = createOpQueue({ hasAuthz: () => true });
    const err = await rejectionOf(q.enqueue("conv-a", { kind: "list", path: "." }, 60_000, 20));
    expect(err.message).toMatch(/前台|后台/);
    expect(err.message).not.toContain("未授权");
  });

  it("未授权(hasAuthz=false):维持原『未授权』文案", async () => {
    const q = createOpQueue({ hasAuthz: () => false });
    const err = await rejectionOf(q.enqueue("conv-b", { kind: "list", path: "." }, 60_000, 20));
    expect(err.message).toContain("未授权");
  });

  it("不传 opts:行为向后兼容,仍为『未授权』文案", async () => {
    const q = createOpQueue();
    const err = await rejectionOf(q.enqueue("conv-c", { kind: "list", path: "." }, 60_000, 20));
    expect(err.message).toContain("未授权");
  });
});