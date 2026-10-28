import { describe, expect, it } from "vitest";
import { PtySessionPool, type PtyHandle } from "../../src/server/pty-pool.js";

function fakeFactory(): PtyHandle {
  return { write: () => {}, resize: () => {}, onData: () => {}, onExit: () => {}, kill: () => {} } as PtyHandle;
}

describe("pty 按工作区分桶配额(作者验收)", () => {
  it("单工作区超上限被拒,别的工作区不受影响", () => {
    let t = 1;
    const pool = new PtySessionPool({ factory: fakeFactory, now: () => t++, maxSessions: 100, maxSessionsPerWorkspace: 2 });
    pool.create({ workspaceId: "A", cwd: "/" });
    pool.create({ workspaceId: "A", cwd: "/" });
    expect(() => pool.create({ workspaceId: "A", cwd: "/" })).toThrow(/工作区|上限/);
    // 另一个工作区仍能建
    expect(() => pool.create({ workspaceId: "B", cwd: "/" })).not.toThrow();
    expect(() => pool.create({ workspaceId: "B", cwd: "/" })).not.toThrow();
    expect(() => pool.create({ workspaceId: "B", cwd: "/" })).toThrow(/工作区|上限/);
  });
});