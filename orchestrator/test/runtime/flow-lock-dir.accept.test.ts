import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { FlowTracker, flowLockDir } from "../../src/runtime/flowstate.js";

let base: string;
beforeEach(() => { base = mkdtempSync(join(tmpdir(), "kp-lockdir-")); });
afterEach(() => { rmSync(base, { recursive: true, force: true }); });

describe("流状态写锁目录（作者锁定）", () => {
  test("生产布局 .kunpeng/state → 锁仍在兄弟目录 .kunpeng/locks/state（位置不变）", () => {
    expect(flowLockDir("/repo/.kunpeng/state", "f1")).toBe("/repo/.kunpeng/locks/state/f1");
  });

  test("其它目录名（测试临时目录）→ 锁放进自己目录，不落到公共父目录", () => {
    expect(flowLockDir("/tmp/kp-gate-ledger-abc", "f1")).toBe("/tmp/kp-gate-ledger-abc/.locks/f1");
  });

  test("两个同父的临时状态目录并发写同名流：互不干扰、父目录下不出现公共 locks", async () => {
    const a = join(base, "kp-a");
    const b = join(base, "kp-b");
    mkdirSync(a);
    mkdirSync(b);
    const ta = new FlowTracker(a);
    const tb = new FlowTracker(b);
    await Promise.all([ta.start("f1", "A"), tb.start("f1", "B")]);
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? ta : tb).addTokens("f1", 10)));
    await Promise.all([ta.finish("f1", "verified"), tb.finish("f1", "rolled-back")]);
    const [sa, sb] = await Promise.all([ta.read("f1"), tb.read("f1")]);
    expect(sa?.requirement).toBe("A");
    expect(sb?.requirement).toBe("B");
    expect(sa?.tokensUsed).toBe(100);
    expect(sb?.tokensUsed).toBe(100);
    expect(sa?.status).toBe("verified");
    expect(sb?.status).toBe("rolled-back");
    expect(existsSync(join(base, "locks"))).toBe(false);
  });

  test("锁子目录不影响 list()：只列出流状态文件", async () => {
    const dir = join(base, "kp-list");
    mkdirSync(dir);
    const t = new FlowTracker(dir);
    await t.start("f1", "req");
    await t.start("f2", "req");
    expect((await t.list()).map((s) => s.flowId).sort()).toEqual(["f1", "f2"]);
  });

  test("生产布局下写入照常（锁在 .kunpeng/locks 下，状态落在 .kunpeng/state）", async () => {
    const stateDir = join(base, ".kunpeng", "state");
    mkdirSync(stateDir, { recursive: true });
    const t = new FlowTracker(stateDir);
    await t.start("f1", "req");
    await t.finish("f1", "verified");
    expect((await t.read("f1"))?.status).toBe("verified");
    expect(existsSync(join(stateDir, ".locks"))).toBe(false);
  });
});