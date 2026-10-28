import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SwitchboardStore } from "../../src/switchboard/store.js";
import { sendStop } from "../../src/switchboard/signal.js";
import { checkStopSignal } from "../../src/switchboard/checkpoint.js";

describe("checkStopSignal", () => {
  let dir: string;
  let seq = 0;
  const deps = { now: () => 1000 + seq, id: () => `m${seq++}` };
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ckpt-")); seq = 0; });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("无 stop 时 halt=false", async () => {
    const store = new SwitchboardStore(dir);
    const r = await checkStopSignal(store, "me", deps);
    expect(r).toEqual({ halt: false, acked: [] });
  });

  it("有发给本实例的 stop 时 halt=true 并回执，之后不再 pending", async () => {
    const store = new SwitchboardStore(dir);
    const stop = await sendStop(store, "other", "me", "停", deps);
    const r = await checkStopSignal(store, "me", deps);
    expect(r.halt).toBe(true);
    expect(r.acked).toEqual([stop.id]);
    expect(await store.pendingStops("me")).toEqual([]);
  });

  it("第二次检查点不再 halt（已回执）", async () => {
    const store = new SwitchboardStore(dir);
    await sendStop(store, "other", "me", "停", deps);
    await checkStopSignal(store, "me", deps);
    const again = await checkStopSignal(store, "me", deps);
    expect(again.halt).toBe(false);
  });

  it("发给别的实例的 stop 不影响本实例", async () => {
    const store = new SwitchboardStore(dir);
    await sendStop(store, "other", "someone-else", "停", deps);
    const r = await checkStopSignal(store, "me", deps);
    expect(r.halt).toBe(false);
  });

  it("广播 all 的 stop 也会 halt 本实例", async () => {
    const store = new SwitchboardStore(dir);
    await sendStop(store, "other", "all", "全停", deps);
    const r = await checkStopSignal(store, "me", deps);
    expect(r.halt).toBe(true);
  });
});
