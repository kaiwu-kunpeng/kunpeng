import { describe, it, expect } from "vitest";
import {
  PEER_WINDOW_MS,
  createPeerMessagesReader,
  filterPeerMessages,
} from "../../src/chat/peer-timeline.js";
import type { SwitchMessage } from "../../src/switchboard/store.js";

const NOW = 1_000_000_000_000;

function msg(id: string, kind: string, ts: number): SwitchMessage {
  return { id, from: "peer-a", to: "self", kind, body: `body-${id}`, ts } as unknown as SwitchMessage;
}

describe("filterPeerMessages", () => {
  it("只留 kind=msg，协议报文全部滤掉", () => {
    const input = [
      msg("m1", "msg", NOW - 1000),
      msg("r1", "receipt", NOW - 1000),
      msg("t1", "task_assignment", NOW - 1000),
      msg("s1", "shutdown_request", NOW - 1000),
    ];
    const out = filterPeerMessages(input, NOW, PEER_WINDOW_MS);
    expect(out.map((m) => m.id)).toEqual(["m1"]);
  });

  it("超出时间窗的 msg 被滤掉，窗内保留", () => {
    const input = [
      msg("old", "msg", NOW - PEER_WINDOW_MS - 1),
      msg("fresh", "msg", NOW - 1000),
    ];
    const out = filterPeerMessages(input, NOW, PEER_WINDOW_MS);
    expect(out.map((m) => m.id)).toEqual(["fresh"]);
  });

  it("不改写入参，返回原对象引用", () => {
    const a = msg("a", "msg", NOW - 10);
    const input = [a, msg("b", "receipt", NOW - 10)];
    const snapshot = [...input];
    const out = filterPeerMessages(input, NOW, PEER_WINDOW_MS);
    expect(input).toEqual(snapshot);
    expect(out[0]).toBe(a);
  });

  it("PEER_WINDOW_MS 是 7 天", () => {
    expect(PEER_WINDOW_MS).toBe(7 * 24 * 3600 * 1000);
  });
});

describe("createPeerMessagesReader 接入过滤", () => {
  it("协议报文与超窗消息都不进结果", async () => {
    const inboxMessages = [
      msg("keep", "msg", NOW - 1000),
      msg("proto", "receipt", NOW - 1000),
      msg("stale", "msg", NOW - PEER_WINDOW_MS - 1),
    ];
    const reader = createPeerMessagesReader({
      self: "self",
      username: "u",
      inbox: async () => inboxMessages,
      activity: async () => [{ convId: "c1", turnTimes: [NOW - 5000] }],
      now: () => NOW,
    });
    const out = await reader({ id: "c1" });
    expect(out.map((m) => m.id)).toEqual(["keep"]);
  });
});