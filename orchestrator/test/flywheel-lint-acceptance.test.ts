import { describe, it, expect } from "vitest";
import { acceptanceCmdForSource } from "../src/feedback/finding-to-task.js";
import type { ProjectChecks } from "../src/project/detect.js";
import { cliSource } from "./helpers/cli-source.js";

describe("飞轮 lint 项验收命令接线", () => {
  it("acceptanceCmdForSource：guardian:lint → detected.lint（行为基线）", () => {
    const cmd = acceptanceCmdForSource("guardian:lint", {
      lint: "cd orchestrator && npm run lint",
    } as ProjectChecks);
    expect(cmd).toBe("cd orchestrator && npm run lint");
  });

  it("acceptanceCmdForSource：未知 source → undefined", () => {
    expect(acceptanceCmdForSource("guardian:unknown", {} as ProjectChecks)).toBeUndefined();
  });

  it("cli.ts 飞轮自转 drive：runOne 收 entry 且按来源派生 lint 验收命令", () => {
    const src = cliSource();
    // 锚定自转 drive 入口 runFlywheelRound，取其后窗口（不依赖命令顺序/分隔符）
    const anchor = src.indexOf("runFlywheelRound(");
    expect(anchor).toBeGreaterThan(-1);
    const block = src.slice(anchor, anchor + 1800);
    // 自转 drive 的 runOne 必须能拿到 entry（否则取不到 entry.source）
    expect(/runOne:\s*async\s*\(\s*requirement\s*,\s*entry\s*\)/.test(block)).toBe(true);
    // 自转路按 backlog 项来源派生验收命令（lint→detected.lint），不再裸 acceptArg
    expect(/acceptanceCmdForSource\(\s*entry\.source/.test(block)).toBe(true);
  });
});
