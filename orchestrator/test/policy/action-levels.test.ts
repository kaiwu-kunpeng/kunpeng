import { describe, expect, it } from "vitest";
import {
  ACTION_LEVELS, ACTION_LEVEL_TABLE, MAX_LEVEL_FOR_SYNTHETIC_EVIDENCE, actionLevelRow, classifyActionLevel,
  isActionLevel, isHardGateLevel, levelPriority, needsSecondConfirm, renderActionLevelTable, syntheticEvidenceAllowed,
} from "../../src/policy/action-levels.js";

describe("动作分级表 L0–L4 单一来源（作者锁定）", () => {
  it("五行按序，门与二次确认与合成证据许可逐级正确", () => {
    expect(ACTION_LEVELS).toEqual(["L0", "L1", "L2", "L3", "L4"]);
    expect(ACTION_LEVEL_TABLE.map((r) => r.level)).toEqual(["L0", "L1", "L2", "L3", "L4"]);
    expect(ACTION_LEVEL_TABLE.map((r) => r.gate)).toEqual(["none", "none", "auto", "soft", "hard"]);
    expect(ACTION_LEVEL_TABLE.map((r) => r.secondConfirm)).toEqual([false, false, false, false, true]);
    expect(ACTION_LEVEL_TABLE.map((r) => r.syntheticEvidenceOk)).toEqual([true, true, false, false, false]);
    expect(actionLevelRow("L3")).toMatchObject({ label: "对外可见但可逆", gate: "soft" });
    expect(actionLevelRow("L4").label).toBe("对外可见且不可逆或花钱");
    expect(actionLevelRow("L0").label).toBe("只读");
    expect(actionLevelRow("L1").label).toBe("出草稿");
    expect(actionLevelRow("L2").label).toBe("有界自动");
  });

  it("谓词：硬门=L3/L4；二次确认仅 L4；优先级 L4→0…L0→4、未定义→5；合成证据只到 L1", () => {
    expect(ACTION_LEVELS.map(isHardGateLevel)).toEqual([false, false, false, true, true]);
    expect(isHardGateLevel(undefined)).toBe(false);
    expect(ACTION_LEVELS.map(needsSecondConfirm)).toEqual([false, false, false, false, true]);
    expect(ACTION_LEVELS.map(levelPriority)).toEqual([4, 3, 2, 1, 0]);
    expect(levelPriority(undefined)).toBe(5);
    expect(MAX_LEVEL_FOR_SYNTHETIC_EVIDENCE).toBe("L1");
    expect(ACTION_LEVELS.map(syntheticEvidenceAllowed)).toEqual([true, true, false, false, false]);
    expect(isActionLevel("L2")).toBe(true);
    expect(isActionLevel("L5")).toBe(false);
    expect(isActionLevel(2)).toBe(false);
  });

  it("classifyActionLevel：只读→L0；草稿→L1；对外可见可逆→L3；对外可见且不可逆或花钱→L4；其余→L2", () => {
    expect(classifyActionLevel({ readOnly: true, externallyVisible: true })).toBe("L0");
    expect(classifyActionLevel({ draftOnly: true, spendsMoney: true })).toBe("L1");
    expect(classifyActionLevel({ externallyVisible: true, reversible: true })).toBe("L3");
    expect(classifyActionLevel({ thirdPartyAuth: true })).toBe("L3");
    expect(classifyActionLevel({ externallyVisible: true, reversible: false })).toBe("L4");
    expect(classifyActionLevel({ thirdPartyAuth: true, spendsMoney: true })).toBe("L4");
    expect(classifyActionLevel({ reversible: false })).toBe("L2");
    expect(classifyActionLevel({})).toBe("L2");
  });

  it("renderActionLevelTable：markdown 五行，门列用中文，末尾无换行", () => {
    const md = renderActionLevelTable();
    const lines = md.split("\n");
    expect(lines[0]).toBe("| 等级 | 名称 | 含义 | 门 |");
    expect(lines[1]).toBe("|---|---|---|---|");
    expect(lines).toHaveLength(7);
    expect(lines[2]).toBe("| L0 | 只读 | 读取、抓取、度量；不产生副作用 | 无门 |");
    expect(lines[4]).toContain("| L2 | 有界自动 |");
    expect(lines[4]).toContain("| 自动放行（合并门等机器门） |");
    expect(lines[5]).toContain("| 软门（人批一次） |");
    expect(lines[6]).toContain("| L4 | 对外可见且不可逆或花钱 |");
    expect(lines[6]).toContain("| 硬门（二次确认） |");
    expect(md.endsWith("\n")).toBe(false);
  });
});