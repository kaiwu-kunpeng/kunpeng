import { describe, expect, test, vi } from "vitest";
import { PtySessionPool, type PtyHandle, type PtySpawnOpts } from "../../src/server/pty-pool.js";

class FakePty implements PtyHandle {
  killed = false;
  private exitCb?: (c: number) => void;
  write(): void {}
  resize(): void {}
  onData(): void {}
  onExit(cb: (c: number) => void): void { this.exitCb = cb; }
  kill(): void { this.killed = true; }
  triggerExit(code: number): void { this.exitCb?.(code); }
}

function makePool() {
  const ptys: FakePty[] = [];
  const factory = (_o: PtySpawnOpts) => { const p = new FakePty(); ptys.push(p); return p; };
  const pool = new PtySessionPool({ factory });
  return { pool, ptys };
}

describe("PtySessionPool onExit 订阅口", () => {
  test("pty 退出时通知订阅者并带 exit code，alive 翻 false", () => {
    const { pool, ptys } = makePool();
    const s = pool.create({ workspaceId: "w", cwd: "/" });
    const cb = vi.fn();
    pool.onExit(s.id, cb);
    ptys[0].triggerExit(7);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(7);
    expect(pool.get(s.id)?.alive).toBe(false);
  });

  test("订阅已退出的会话 → 立即用已存的 exitCode 回调（不丢失已发生的退出）", () => {
    const { pool, ptys } = makePool();
    const s = pool.create({ workspaceId: "w", cwd: "/" });
    ptys[0].triggerExit(3);
    const cb = vi.fn();
    pool.onExit(s.id, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(3);
  });

  test("退订后不再被通知", () => {
    const { pool, ptys } = makePool();
    const s = pool.create({ workspaceId: "w", cwd: "/" });
    const cb = vi.fn();
    const off = pool.onExit(s.id, cb);
    off();
    ptys[0].triggerExit(0);
    expect(cb).not.toHaveBeenCalled();
  });

  test("多订阅者全部收到", () => {
    const { pool, ptys } = makePool();
    const s = pool.create({ workspaceId: "w", cwd: "/" });
    const a = vi.fn();
    const b = vi.fn();
    pool.onExit(s.id, a);
    pool.onExit(s.id, b);
    ptys[0].triggerExit(1);
    expect(a).toHaveBeenCalledWith(1);
    expect(b).toHaveBeenCalledWith(1);
  });
});