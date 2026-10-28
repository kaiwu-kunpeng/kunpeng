import { describe, expect, it } from "vitest";
import {
  RAISE_BLOCKER_INSTRUCTION,
  RAISE_BLOCKER_PREFIX,
  isRaiseBlocker,
  parseRaiseBlocker,
  raiseBlockerReason,
} from "../../src/runtime/raise-blocker.js";

describe("求助标记（作者锁定）", () => {
  it("取最后一条 RAISE_BLOCKER 行，容忍前后空白", () => {
    expect(parseRaiseBlocker("看了 spec\n  RAISE_BLOCKER:   缺 DATABASE_URL，跑不了迁移  \n")).toBe("缺 DATABASE_URL，跑不了迁移");
    expect(parseRaiseBlocker("RAISE_BLOCKER: 第一条\n做了点事\nRAISE_BLOCKER: 第二条")).toBe("第二条");
    expect(parseRaiseBlocker("正文里提到 RAISE_BLOCKER: 不算，因为不在行首位置")).toBeUndefined();
    expect(parseRaiseBlocker("说明：卡住时输出 RAISE_BLOCKER: 原因\n真的卡了\nRAISE_BLOCKER: 缺 key")).toBe("缺 key");
  });

  it("没有标记、空原因、非字符串 → undefined", () => {
    expect(parseRaiseBlocker("done")).toBeUndefined();
    expect(parseRaiseBlocker("RAISE_BLOCKER:   ")).toBeUndefined();
    expect(parseRaiseBlocker(undefined as unknown as string)).toBeUndefined();
  });

  it("前缀判定与去前缀", () => {
    expect(RAISE_BLOCKER_PREFIX).toBe("raise-blocker: ");
    expect(isRaiseBlocker("raise-blocker: 缺 key")).toBe(true);
    expect(isRaiseBlocker("budget-exceeded: usd 120%")).toBe(false);
    expect(isRaiseBlocker(undefined)).toBe(false);
    expect(raiseBlockerReason("raise-blocker: 缺 key")).toBe("缺 key");
    expect(raiseBlockerReason("其它")).toBe("其它");
  });

  it("给 agent 的说明：含字面标记，点名三类可求助与四条不是求助理由", () => {
    const s = RAISE_BLOCKER_INSTRUCTION;
    expect(s).toContain("RAISE_BLOCKER:");
    expect(s).toContain("凭据");
    expect(s).toContain("不可达");
    expect(s).toContain("不是求助理由");
    expect(s).toContain("先红后绿");
    expect(s).toContain("沙箱");
    expect(s).toContain(".kunpeng/");
    expect(s).toContain("歧义");
    expect(s).toContain("有经验的工程师");
    expect(s.length).toBeGreaterThan(200);
  });
});