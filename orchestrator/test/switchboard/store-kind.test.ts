import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SwitchboardStore, newMessage, kindOf } from "../../src/switchboard/store.js";

describe("switchboard kind: stop/receipt 模型", () => {
  let dir: string;
  let seq = 0;
  const deps = { now: () => 1000 + seq, id: () => `m${seq++}` };
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "sbk-")); seq = 0; });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("缺省消息 kind 视为 msg，且不写 kind 字段（向后兼容）", () => {
    const m = newMessage({ from: "a", to: "b", body: "hi" }, deps);
    expect(kindOf(m)).toBe("msg");
    expect("kind" in m).toBe(false);
  });

  it("stop 消息写入 kind，kindOf 正确识别", () => {
    const m = newMessage({ from: "a", to: "b", body: "停", kind: "stop" }, deps);
    expect(m.kind).toBe("stop");
    expect(kindOf(m)).toBe("stop");
  });

  it("pendingStops 只返回未回执的 stop", async () => {
    const store = new SwitchboardStore(dir);
    const stop1 = newMessage({ from: "a", to: "b", body: "停1", kind: "stop" }, deps);
    const stop2 = newMessage({ from: "a", to: "b", body: "停2", kind: "stop" }, deps);
    await store.append(stop1);
    await store.append(stop2);
    const rcpt = newMessage({ from: "b", to: "a", topic: stop1.id, body: "收到", kind: "receipt" }, deps);
    await store.append(rcpt);
    const pending = await store.pendingStops("b");
    expect(pending.map((m) => m.id)).toEqual([stop2.id]);
  });

  it("pendingStops 包含发给 all 的 stop", async () => {
    const store = new SwitchboardStore(dir);
    const stopAll = newMessage({ from: "a", to: "all", body: "全停", kind: "stop" }, deps);
    await store.append(stopAll);
    const pending = await store.pendingStops("b");
    expect(pending.map((m) => m.id)).toEqual([stopAll.id]);
  });
});
