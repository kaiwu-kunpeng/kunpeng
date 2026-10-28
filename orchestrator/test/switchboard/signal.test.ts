import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SwitchboardStore, kindOf } from "../../src/switchboard/store.js";
import { sendStop, ackStop, checkStopSignal } from "../../src/switchboard/signal.js";

describe("signal: sendStop / ackStop", () => {
  let dir: string;
  let seq = 0;
  const deps = { now: () => 1000 + seq, id: () => `m${seq++}` };
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "sig-")); seq = 0; });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("sendStop 落一条 kind=stop 消息，pendingStops 能查到", async () => {
    const store = new SwitchboardStore(dir);
    const stop = await sendStop(store, "a", "b", "停一下", deps);
    expect(kindOf(stop)).toBe("stop");
    expect(stop.to).toBe("b");
    const pending = await store.pendingStops("b");
    expect(pending.map((m) => m.id)).toEqual([stop.id]);
  });

  it("sendStop 缺收件人抛错", async () => {
    const store = new SwitchboardStore(dir);
    await expect(sendStop(store, "a", "", "x", deps)).rejects.toThrow(/收件人/);
  });

  it("ackStop 回执后 pendingStops 不再含该 stop", async () => {
    const store = new SwitchboardStore(dir);
    const stop = await sendStop(store, "a", "b", "停", deps);
    const rcpt = await ackStop(store, stop, "b", deps);
    expect(kindOf(rcpt)).toBe("receipt");
    expect(rcpt.to).toBe("a");
    expect(rcpt.topic).toBe(stop.id);
    expect(await store.pendingStops("b")).toEqual([]);
  });

  it("ackStop 对非 stop 消息抛错", async () => {
    const store = new SwitchboardStore(dir);
    const notStop = { id: "x", from: "a", to: "b", body: "hi", ts: 1, read: false } as const;
    await expect(ackStop(store, notStop, "b", deps)).rejects.toThrow(/stop/);
  });

  it("checkStopSignal 无 pending stop 时不写回执", async () => {
    const store = new SwitchboardStore(dir);
    const result = await checkStopSignal(store, "b", deps);
    expect(result).toEqual({ stopped: false, stops: [], receipts: [], reason: "" });
    expect(await store.list()).toEqual([]);
  });

  it("checkStopSignal 命中 stop 后自动回执、标记已读并清掉 pending", async () => {
    const store = new SwitchboardStore(dir);
    const direct = await sendStop(store, "a", "b", "停一下", deps);
    const broadcast = await sendStop(store, "ops", "all", "全员停", deps);

    const result = await checkStopSignal(store, "b", deps);

    expect(result.stopped).toBe(true);
    expect(result.stops.map((m) => m.id)).toEqual([direct.id, broadcast.id]);
    expect(result.receipts).toHaveLength(2);
    expect(result.receipts.every((m) => kindOf(m) === "receipt")).toBe(true);
    expect(result.receipts.map((m) => m.from)).toEqual(["b", "b"]);
    expect(result.receipts.map((m) => m.topic)).toEqual([direct.id, broadcast.id]);
    expect(result.reason).toContain("[a] 停一下");
    expect(result.reason).toContain("[ops] 全员停");
    expect(await store.pendingStops("b")).toEqual([]);

    const listed = await store.list();
    expect(listed.find((m) => m.id === direct.id)?.read).toBe(true);
    expect(listed.find((m) => m.id === broadcast.id)?.read).toBe(true);
    expect((await store.pendingStops("other")).map((m) => m.id)).toEqual([broadcast.id]);
  });

  it("checkStopSignal 空实例身份 fail-closed", async () => {
    const store = new SwitchboardStore(dir);
    await expect(checkStopSignal(store, "  ", deps)).rejects.toThrow(/实例身份/);
  });
});
