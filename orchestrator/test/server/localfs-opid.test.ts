import { describe, it, expect } from "vitest";
import { createOpQueue } from "../../src/server/localfs/op-queue.js";

describe("localfs opId 随机不可猜(消 H2 放大器)", () => {
  it("两次 enqueue 的 opId 不同、非自增、非顺序可猜", async () => {
    const q = createOpQueue();
    // enqueue 返回 Promise(等 result),我们不 await 完成,只观察 take 到的 op.opId
    void q.enqueue("convA", { kind: "list", path: "" } as never, 5_000).catch(() => {});
    void q.enqueue("convA", { kind: "list", path: "" } as never, 5_000).catch(() => {});
    const first = q.take("convA");
    const second = q.take("convA");
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    const id1 = (first as { opId: string }).opId;
    const id2 = (second as { opId: string }).opId;
    expect(id1).not.toBe(id2);
    expect(id1.startsWith("localfs-")).toBe(true);
    // 非自增:不应是 localfs-1 / localfs-2 这类可猜序列
    expect(id1).not.toMatch(/^localfs-\d+$/);
    expect(id2).not.toMatch(/^localfs-\d+$/);
  });
});