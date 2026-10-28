import { describe, it, expect } from "vitest";
import { compareByTsThenId } from "../../src/switchboard/store.js";
import type { SwitchMessage } from "../../src/switchboard/store.js";
import { deriveTask } from "../../src/switchboard/task.js";

const m = (id: string, ts: number, extra: Partial<SwitchMessage> = {}): SwitchMessage => ({
  id, from: "x", to: "all", body: "", ts, read: false, ...extra,
});

describe("确定性排序: ts 平局按 id tie-break(消除 readdir 依赖的 flaky)", () => {
  it("compareByTsThenId: ts 优先, 同 ts 按 id 升序且确定", () => {
    expect(compareByTsThenId(m("a", 1), m("b", 9))).toBeLessThan(0);     // ts 优先
    expect(compareByTsThenId(m("b", 5), m("a", 5))).toBeGreaterThan(0);  // 同 ts: b>a
    expect(compareByTsThenId(m("a", 5), m("b", 5))).toBeLessThan(0);     // 同 ts: a<b
    expect(compareByTsThenId(m("a", 5), m("a", 5))).toBe(0);            // 全等
  });

  it("deriveTask: 同 ts 消息无论输入顺序, history 次序确定(按 id), 不再 flaky", () => {
    const A = m("t1", 100, { kind: "task" });
    const B = m("z-reply", 100, { topic: "t1" });
    const C = m("a-reply", 100, { topic: "t1" });
    const h1 = deriveTask("t1", [A, B, C])!.history.map((x) => x.id);
    const h2 = deriveTask("t1", [C, A, B])!.history.map((x) => x.id);
    const h3 = deriveTask("t1", [B, C, A])!.history.map((x) => x.id);
    expect(h1).toEqual(["a-reply", "t1", "z-reply"]); // 按 id 升序, 确定
    expect(h2).toEqual(h1);                            // 输入乱序不影响输出
    expect(h3).toEqual(h1);
  });

  it("deriveTask: ts 不等时仍按 ts(tie-break 不干扰真实创建序)", () => {
    const create = m("zzz", 100, { kind: "task" });        // id 大但 ts 小
    const reply = m("aaa", 200, { topic: "zzz" });          // id 小但 ts 大
    const h = deriveTask("zzz", [reply, create])!.history.map((x) => x.id);
    expect(h).toEqual(["zzz", "aaa"]);                      // 仍按 ts: create 先
  });
});
