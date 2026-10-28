import { describe, expect, it } from "vitest";
import { buildReplayTurns } from "../src/server/chat-persistence.js";

const t = (role: "user" | "assistant", text: string, compact?: boolean) => ({
  role,
  text,
  ...(compact ? { compact: true } : {}),
});

describe("压缩重放守卫", () => {
  it("对 /compact 轮编辑重发时,重放上一压缩点以来的完整历史而不是空历史", () => {
    const turns = [t("user", "问题A"), t("assistant", "回答A"), t("user", "/compact"), t("assistant", "摘要S", true)];
    const replay = buildReplayTurns({ turns }, true);
    expect(replay.map((x) => x.text)).toEqual(["问题A", "回答A"]);
  });

  it("末轮为普通轮时行为与旧版一致:从压缩点起且去掉末轮", () => {
    const turns = [t("user", "早"), t("assistant", "答"), t("user", "/compact"), t("assistant", "摘要S", true), t("user", "新问"), t("assistant", "新答")];
    const replay = buildReplayTurns({ turns }, true);
    expect(replay).toHaveLength(1);
    expect(replay[0].text).toBe("【前文摘要】摘要S");
  });

  it("重放时压缩摘要轮带【前文摘要】标注且不改动存储对象", () => {
    const turns = [t("user", "早"), t("assistant", "答"), t("user", "/compact"), t("assistant", "摘要S", true), t("user", "新问"), t("assistant", "新答")];
    const replay = buildReplayTurns({ turns }, false);
    expect(replay[0].text).toBe("【前文摘要】摘要S");
    expect(replay.map((x) => x.text)).toEqual(["【前文摘要】摘要S", "新问", "新答"]);
    expect(turns[3].text).toBe("摘要S");
  });

  it("无压缩点时返回全部且无标注", () => {
    const turns = [t("user", "q"), t("assistant", "a")];
    expect(buildReplayTurns({ turns }, false).map((x) => x.text)).toEqual(["q", "a"]);
  });

  it("无压缩点时 excludeLastRound 仍正确剥掉末轮", () => {
    const turns = [t("user", "q1"), t("assistant", "a1"), t("user", "q2"), t("assistant", "a2")];
    expect(buildReplayTurns({ turns }, true).map((x) => x.text)).toEqual(["q1", "a1"]);
  });
});