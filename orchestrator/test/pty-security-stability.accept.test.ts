import { describe, expect, it } from "vitest";
import { PtySessionPool, type PtyHandle, type PtySpawnOpts } from "../src/server/pty-pool.js";
import { resolveSessionForConnection } from "../src/server/pty-endpoint.js";

function fakeFactory(_opts: PtySpawnOpts): PtyHandle & { __emit(d: string): void } {
  let onData: ((d: string) => void) | undefined;
  return {
    write: () => {},
    resize: () => {},
    onData: (cb) => { onData = cb; },
    onExit: () => {},
    kill: () => {},
    // 允许测试主动喂输出,验证"输出不再保护存活会话免于回收"
    __emit: (d: string) => onData?.(d),
  };
}

describe("pty 安全与稳定(作者验收)", () => {
  it("跨 workspace 复用被拒(mismatch),同 workspace 复用成功", async () => {
    const alive: Record<string, string> = { "s1": "wsA" };
    const cross = await resolveSessionForConnection(
      { wantSession: "s1", workspaceId: "wsB" },
      { aliveWorkspace: (id) => alive[id] },
    );
    expect(cross.mismatch).toBe(true);
    expect(cross.id).toBeUndefined();

    const same = await resolveSessionForConnection(
      { wantSession: "s1", workspaceId: "wsA" },
      { aliveWorkspace: (id) => alive[id] },
    );
    expect(same.id).toBe("s1");
    expect(same.mismatch).toBeFalsy();
  });

  it("无订阅者的会话超时被回收,有活跃订阅者的不被回收", () => {
    let t = 1000;
    const pool = new PtySessionPool({ factory: fakeFactory, now: () => t, idleReapMs: 100 });
    const watched = pool.create({ workspaceId: "w", cwd: "/tmp" });
    const abandoned = pool.create({ workspaceId: "w", cwd: "/tmp" });

    // 一个持续被订阅(有人看),一个订阅后退订(无人看)
    pool.subscribe(watched.id, () => {});
    const unsub = pool.subscribe(abandoned.id, () => {});
    unsub();

    t = 1000 + 200; // 超过 idleReapMs
    const reaped = pool.reap();
    expect(reaped).toContain(abandoned.id);
    expect(reaped).not.toContain(watched.id);
    expect(pool.get(watched.id)).toBeTruthy();
    expect(pool.get(abandoned.id)).toBeUndefined();
  });

  it("从未被 attach 的孤儿会话超时也被回收", () => {
    let t = 5000;
    const pool = new PtySessionPool({ factory: fakeFactory, now: () => t, idleReapMs: 100 });
    const orphan = pool.create({ workspaceId: "w", cwd: "/tmp" });
    t = 5000 + 500;
    expect(pool.reap()).toContain(orphan.id);
  });
});