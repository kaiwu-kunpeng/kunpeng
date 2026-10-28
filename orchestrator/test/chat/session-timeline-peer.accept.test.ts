import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mergeTimeline, peerMessageToTurn } from "../../src/chat/peer-timeline.js";
import { tailTurns, type ChatTurn } from "../../src/chat/conversation-store.js";
import type { SwitchMessage } from "../../src/switchboard/store.js";

const msg = (over: Partial<SwitchMessage>): SwitchMessage => ({
  id: "m1",
  from: "cc-a",
  to: "main",
  body: "收口了",
  ts: 100,
  read: false,
  ...over,
});

const turn = (text: string, at?: number): ChatTurn => ({ role: "user", text, ...(at === undefined ? {} : { at }) });

describe("会话流水统一:跨实例消息并流 + 尾部读取", () => {
  test("产物落盘:peer-timeline 模块存在", () => {
    expect(existsSync(join(process.cwd(), "src/chat/peer-timeline.ts"))).toBe(true);
  });

  test("peerMessageToTurn 映射逐字一致", () => {
    expect(peerMessageToTurn(msg({}))).toEqual({
      role: "user",
      kind: "peer",
      at: 100,
      text: "【cc-a】收口了",
      peer: { from: "cc-a", topic: undefined, msgId: "m1" },
    });
    expect(peerMessageToTurn(msg({ topic: "交付" })).text).toBe("【cc-a · 交付】收口了");
  });

  test("按时间升序合并,同时间原 turn 在前", () => {
    const turns = [turn("a", 10), turn("b", 30)];
    const peers = [peerMessageToTurn(msg({ id: "p1", ts: 20 })), peerMessageToTurn(msg({ id: "p2", ts: 30 }))];
    const merged = mergeTimeline(turns, peers);
    expect(merged.map((t) => (t.kind === "peer" ? t.peer?.msgId : t.text))).toEqual(["a", "p1", "b", "p2"]);
  });

  test("无 at 的 turn 继承前一条时间,元素引用不变", () => {
    const first = turn("a", 10);
    const second = turn("b");
    const peer = peerMessageToTurn(msg({ id: "p1", ts: 15 }));
    const merged = mergeTimeline([first, second], [peer]);
    expect(merged.map((t) => (t.kind === "peer" ? "peer" : t.text))).toEqual(["a", "b", "peer"]);
    expect(merged[0]).toBe(first);
    expect(merged[1]).toBe(second);
  });

  test("首条无 at 视为 0", () => {
    const merged = mergeTimeline([turn("a")], [peerMessageToTurn(msg({ ts: 5 }))]);
    expect(merged.map((t) => (t.kind === "peer" ? "peer" : t.text))).toEqual(["a", "peer"]);
  });

  test("tailTurns 三种边界", () => {
    const turns = [turn("a", 1), turn("b", 2), turn("c", 3)];
    expect(tailTurns(turns, 0)).toEqual([]);
    expect(tailTurns(turns, -3)).toEqual([]);
    expect(tailTurns(turns, 99)).toHaveLength(3);
    const tail = tailTurns(turns, 2);
    expect(tail.map((t) => t.text)).toEqual(["b", "c"]);
    expect(tail[1]).toBe(turns[2]);
  });

  test("空 peer 列表时原样返回", () => {
    const turns = [turn("a", 1), turn("b", 2)];
    expect(mergeTimeline(turns, [])).toEqual(turns);
  });
});