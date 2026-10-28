import { describe, it, expect } from "vitest";
import { PtySessionPool, type PtyHandle, type PtySpawnOpts } from "../../src/server/pty-pool.js";

class FakePty implements PtyHandle {
  killed = false;
  paused = false;
  private exitCb?: (c: number) => void;
  constructor(public opts: PtySpawnOpts) {}
  write(): void {}
  resize(): void {}
  onData(): void {}
  onExit(cb: (c: number) => void): void { this.exitCb = cb; }
  kill(): void { this.killed = true; }
  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }
  triggerExit(code: number): void { this.exitCb?.(code); }
}

function makePool(clock: { t: number }, extra?: { maxSessions?: number; idleReapMs?: number; deadGraceMs?: number }) {
  const ptys: FakePty[] = [];
  const factory = (o: PtySpawnOpts) => { const p = new FakePty(o); ptys.push(p); return p; };
  const pool = new PtySessionPool({ factory, now: () => clock.t, ...extra });
  return { pool, ptys };
}

describe("PtySessionPool cap + reap + backpressure", () => {
  it("create rejects once maxSessions is reached", () => {
    const clock = { t: 1000 };
    const { pool } = makePool(clock, { maxSessions: 2 });
    pool.create({ workspaceId: "w", cwd: "/" });
    pool.create({ workspaceId: "w", cwd: "/" });
    expect(() => pool.create({ workspaceId: "w", cwd: "/" })).toThrow(/full|max/i);
  });

  it("reap evicts a dead session only after the grace window", () => {
    const clock = { t: 1000 };
    const { pool, ptys } = makePool(clock, { deadGraceMs: 100 });
    const s = pool.create({ workspaceId: "w", cwd: "/" });
    ptys[0].triggerExit(0); // updatedAt = 1000, alive=false
    clock.t = 1050; // idle 50 < 100
    expect(pool.reap()).toEqual([]);
    expect(pool.get(s.id)).toBeDefined();
    clock.t = 1200; // idle 200 > 100
    expect(pool.reap()).toEqual([s.id]);
    expect(pool.get(s.id)).toBeUndefined();
  });

  it("reap kills and evicts an idle-but-alive session", () => {
    const clock = { t: 1000 };
    const { pool, ptys } = makePool(clock, { idleReapMs: 1000 });
    const s = pool.create({ workspaceId: "w", cwd: "/" });
    clock.t = 2500; // idle 1500 > 1000
    expect(pool.reap()).toContain(s.id);
    expect(ptys[0].killed).toBe(true);
    expect(pool.get(s.id)).toBeUndefined();
  });

  it("reap spares fresh sessions within the idle window", () => {
    const clock = { t: 1000 };
    const { pool } = makePool(clock, { idleReapMs: 1000 });
    const s = pool.create({ workspaceId: "w", cwd: "/" });
    clock.t = 1500; // idle 500 < 1000
    expect(pool.reap()).toEqual([]);
    expect(pool.get(s.id)).toBeDefined();
  });

  it("reaping a dead session frees a slot so create works again", () => {
    const clock = { t: 1000 };
    const { pool, ptys } = makePool(clock, { maxSessions: 1, deadGraceMs: 100 });
    pool.create({ workspaceId: "w", cwd: "/" });
    expect(() => pool.create({ workspaceId: "w", cwd: "/" })).toThrow(/full|max/i);
    ptys[0].triggerExit(0);
    clock.t = 1200;
    expect(pool.reap().length).toBe(1);
    expect(() => pool.create({ workspaceId: "w", cwd: "/" })).not.toThrow();
  });

  it("pause/resume delegate to the handle", () => {
    const clock = { t: 1000 };
    const { pool, ptys } = makePool(clock);
    const s = pool.create({ workspaceId: "w", cwd: "/" });
    pool.pause(s.id);
    expect(ptys[0].paused).toBe(true);
    pool.resume(s.id);
    expect(ptys[0].paused).toBe(false);
  });
});