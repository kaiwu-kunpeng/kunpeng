import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowStateConflictError, FlowTracker } from "../../src/runtime/flowstate.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-flowstate-cas-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.KUNPENG_STATE_CAS;
});

const stateDir = () => join(dir, "state");
const raw = (id: string) => JSON.parse(readFileSync(join(stateDir(), `${id}.json`), "utf8")) as Record<string, unknown>;

describe("flow state 乐观版本号（作者锁定）", () => {
  it("每次写入 version 严格 +1 并落盘；锁目录不在状态目录里", async () => {
    const t = new FlowTracker(stateDir(), () => 1_700_000_000_000);
    await t.start("f1", "req");
    const v1 = (await t.read("f1"))!.version;
    expect(typeof v1).toBe("number");
    expect(v1!).toBeGreaterThanOrEqual(1);
    await t.addTokens("f1", 10);
    expect((await t.read("f1"))!.version).toBe(v1! + 1);
    await t.setChangedFileCount("f1", 3);
    expect((await t.read("f1"))!.version).toBe(v1! + 2);
    expect(raw("f1").version).toBe(v1! + 2);
    expect(raw("f1").schemaVersion).toBeDefined();
    expect((await t.list()).map((f) => f.flowId)).toEqual(["f1"]);
    expect(existsSync(join(stateDir(), ".locks"))).toBe(false);
    expect(existsSync(join(dir, "locks", "state"))).toBe(true);
  });

  it("陈旧副本 compareAndSave 抛 FlowStateConflictError，盘上内容不被覆盖", async () => {
    const t1 = new FlowTracker(stateDir());
    const t2 = new FlowTracker(stateDir());
    await t1.start("f2", "req");
    const stale = (await t1.read("f2"))!;
    await t2.addTokens("f2", 5);
    await expect(t1.compareAndSave({ ...stale, changedFileCount: 9 })).rejects.toBeInstanceOf(FlowStateConflictError);
    const after = (await t1.read("f2"))!;
    expect(after.tokensUsed).toBe(5);
    expect(after.changedFileCount).toBeUndefined();
    expect(after.version).toBe(stale.version! + 1);
  });

  it("两个实例并发写同一流 20 次：无丢失更新", async () => {
    const t1 = new FlowTracker(stateDir());
    const t2 = new FlowTracker(stateDir());
    await t1.start("f3", "req");
    const before = (await t1.read("f3"))!.version!;
    await Promise.all([
      ...Array.from({ length: 10 }, () => t1.addTokens("f3", 1)),
      ...Array.from({ length: 10 }, () => t2.addTokens("f3", 1)),
    ]);
    const s = (await t1.read("f3"))!;
    expect(s.tokensUsed).toBe(20);
    expect(s.version).toBe(before + 20);
  });

  it("mutate：闭包运行在锁外，冲突后在最新状态上重放", async () => {
    const t1 = new FlowTracker(stateDir());
    const t2 = new FlowTracker(stateDir());
    await t1.start("f4", "req");
    let calls = 0;
    const out = await t1.mutate("f4", async (s) => {
      calls += 1;
      if (calls === 1) await t2.addTokens("f4", 7);
      s.changedFileCount = 1;
    });
    expect(calls).toBe(2);
    expect(out?.tokensUsed).toBe(7);
    expect(out?.changedFileCount).toBe(1);
    const disk = (await t1.read("f4"))!;
    expect(disk.tokensUsed).toBe(7);
    expect(disk.changedFileCount).toBe(1);
  });

  it("mutate：闭包返回 false 不写盘、version 不变；未知流返回 null", async () => {
    const t = new FlowTracker(stateDir());
    await t.start("f5", "req");
    const before = (await t.read("f5"))!.version;
    const out = await t.mutate("f5", (s) => {
      s.changedFileCount = 99;
      return false;
    });
    expect(out?.changedFileCount).toBe(99);
    expect((await t.read("f5"))!.changedFileCount).toBeUndefined();
    expect((await t.read("f5"))!.version).toBe(before);
    expect(await t.mutate("nope", () => {})).toBeNull();
  });

  it("KUNPENG_STATE_CAS=0 逃生：陈旧副本直接覆盖不抛", async () => {
    const t1 = new FlowTracker(stateDir());
    const t2 = new FlowTracker(stateDir());
    await t1.start("f6", "req");
    const stale = (await t1.read("f6"))!;
    await t2.addTokens("f6", 5);
    process.env.KUNPENG_STATE_CAS = "0";
    await expect(t1.compareAndSave({ ...stale, changedFileCount: 9 })).resolves.toBeUndefined();
    const after = (await t1.read("f6"))!;
    expect(after.changedFileCount).toBe(9);
    expect(after.version).toBe(stale.version! + 2);
  });

  it("对已存在的流重复 start / startOrResume 不抛冲突", async () => {
    const t = new FlowTracker(stateDir());
    await t.start("f7", "req");
    await t.addTokens("f7", 1);
    await expect(t.start("f7", "req again")).resolves.toBeUndefined();
    await expect(t.startOrResume("f7", "req third")).resolves.toBeUndefined();
    const s = (await t.read("f7"))!;
    expect(s.requirement).toBe("req third");
    expect(s.version).toBe(4);
  });
});