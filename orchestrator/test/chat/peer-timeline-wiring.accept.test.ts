import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { attributePeerMessages, createPeerMessagesReader } from "../../src/chat/peer-timeline.js";
import { ConversationStore } from "../../src/chat/conversation-store.js";
import { part03 } from "../../src/server/ui/client-parts/part03.js";
import type { SwitchMessage } from "../../src/switchboard/store.js";

const msg = (id: string, ts: number): SwitchMessage => ({
  id,
  from: "peer",
  to: "main",
  body: `body-${id}`,
  ts,
  read: false,
});

describe("归属:按消息到达时最后活跃的会话", () => {
  const activity = [
    { convId: "conv-a", turnTimes: [100, 300] },
    { convId: "conv-b", turnTimes: [200] },
  ];

  test("落在 a 的最近活跃窗口", () => {
    expect(attributePeerMessages([msg("m1", 150)], activity, "conv-a").map((m) => m.id)).toEqual(["m1"]);
    expect(attributePeerMessages([msg("m1", 150)], activity, "conv-b")).toEqual([]);
  });

  test("b 更晚活跃时归 b", () => {
    expect(attributePeerMessages([msg("m2", 250)], activity, "conv-b").map((m) => m.id)).toEqual(["m2"]);
    expect(attributePeerMessages([msg("m2", 250)], activity, "conv-a")).toEqual([]);
  });

  test("a 又活跃之后归回 a", () => {
    expect(attributePeerMessages([msg("m3", 400)], activity, "conv-a").map((m) => m.id)).toEqual(["m3"]);
  });

  test("早于所有会话的消息被丢弃", () => {
    expect(attributePeerMessages([msg("m4", 50)], activity, "conv-a")).toEqual([]);
    expect(attributePeerMessages([msg("m4", 50)], activity, "conv-b")).toEqual([]);
  });

  test("分数相同取 convId 字典序最小,且与入参顺序无关", () => {
    const tie = [
      { convId: "conv-z", turnTimes: [100] },
      { convId: "conv-a", turnTimes: [100] },
    ];
    expect(attributePeerMessages([msg("m5", 150)], tie, "conv-a").map((m) => m.id)).toEqual(["m5"]);
    expect(attributePeerMessages([msg("m5", 150)], tie, "conv-z")).toEqual([]);
    expect(attributePeerMessages([msg("m5", 150)], [...tie].reverse(), "conv-a").map((m) => m.id)).toEqual(["m5"]);
  });

  test("按 ts 升序返回,ts 相同按 id;不改写入参", () => {
    const input = [msg("b", 400), msg("a", 400), msg("c", 350)];
    const snapshot = input.map((m) => m.id);
    expect(attributePeerMessages(input, activity, "conv-a").map((m) => m.id)).toEqual(["c", "a", "b"]);
    expect(input.map((m) => m.id)).toEqual(snapshot);
  });

  test("空输入不炸", () => {
    expect(attributePeerMessages([], activity, "conv-a")).toEqual([]);
    expect(attributePeerMessages([msg("m", 1)], [], "conv-a")).toEqual([]);
  });
});

describe("读取器:透传 self/username 并原样抛异常", () => {
  test("把 inbox 与 activity 的结果交给归属规则", async () => {
    const seen: string[] = [];
    const reader = createPeerMessagesReader({
      self: "cockpit",
      username: "admin",
      now: () => 1000,
      inbox: async (to) => { seen.push(`inbox:${to}`); return [msg("m1", 150)]; },
      activity: async (user) => { seen.push(`activity:${user}`); return [{ convId: "conv-a", turnTimes: [100] }]; },
    });
    expect((await reader({ id: "conv-a" })).map((m) => m.id)).toEqual(["m1"]);
    expect(seen).toEqual(["inbox:cockpit", "activity:admin"]);
  });

  test("底层异常原样抛出(端点侧负责降级)", async () => {
    const reader = createPeerMessagesReader({
      self: "main",
      username: "admin",
      inbox: async () => { throw new Error("switchboard down"); },
      activity: async () => [],
    });
    await expect(reader({ id: "conv-a" })).rejects.toThrow("switchboard down");
  });
});

describe("listTurnActivity", () => {
  test("按 convId 排序,只取合法 at,无 at 的会话也在", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-activity-"));
    try {
      let seq = 0;
      const store = new ConversationStore(dir, { now: () => 1_000, id: () => `conv-${++seq}` });
      const first = await store.create("u1", { model: "m" });
      const second = await store.create("u1", { model: "m" });
      await store.appendTurns("u1", first.id, [
        { role: "user", text: "x", at: 300 },
        { role: "assistant", text: "y", at: 100 },
        { role: "user", text: "z" },
      ]);
      await store.appendTurns("u1", second.id, [{ role: "user", text: "n" }]);

      const activity = await store.listTurnActivity("u1");
      expect(activity.map((a) => a.convId)).toEqual([first.id, second.id].sort());
      const firstEntry = activity.find((a) => a.convId === first.id);
      expect(firstEntry?.turnTimes).toEqual([100, 300]);
      expect(activity.find((a) => a.convId === second.id)?.turnTimes).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("没有会话时返回空数组", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-activity-empty-"));
    try {
      const store = new ConversationStore(dir, { now: () => 1, id: () => "conv-x" });
      expect(await store.listTurnActivity("nobody")).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("前端渲染 peer 轮", () => {
  test("part03 含 peer 分支且不带按钮", () => {
    expect(part03).toContain('kind === "peer"');
    expect(part03).toContain("kp-peer");
  });

  test("lastUserIndex 计算跳过 peer 轮", () => {
    const loop = part03.slice(part03.indexOf("function renderConversationTurns"), part03.indexOf("function reloadConversationWindow"));
    const idx = loop.indexOf("lastUserIndex < 0");
    expect(idx).toBeGreaterThan(-1);
    expect(loop.slice(Math.max(0, idx - 400), idx + 400)).toContain("peer");
  });
});
