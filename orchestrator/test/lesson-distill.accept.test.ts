import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLessonPrompt, parseLessons } from "../src/knowledge/lesson-distill.js";
import { appendLesson, listLessons } from "../src/knowledge/lesson-store.js";

const traj = "步骤1: 执行 vitest\n错误: 点名的测试文件不存在于worktree\n步骤2: 整盘中止";
const good = "# Lesson\n## Title 测试文件先落盘再点名\n## Description 写 spec 引用测试文件时用;新文件不适用\n## Content 验收命令点名的既有测试必须确认已在基线中,否则先落盘。\n## Evidence 错误: 点名的测试文件不存在于worktree\n";

describe("Lesson 蒸馏(作者验收)", () => {
  it("提取 prompt 四条纪律齐全", () => {
    const p = buildLessonPrompt({ goal: "g", trajectoryTail: traj, signature: "s" });
    expect(p).toContain("最多提取 2 条");
    expect(p).toContain("不嵌入具体路径/id/字面量");
    expect(p).toContain("逐字引用");
    expect(p).toContain("NO_LESSON");
  });
  it("Evidence 非逐字子串的条目被丢弃", () => {
    const fake = good.replace("错误: 点名的测试文件不存在于worktree", "我猜是网络问题导致失败");
    expect(parseLessons(fake, { trajectoryTail: traj, signature: "s", sourceIds: ["f1"] } as never).length).toBe(0);
    expect(parseLessons(good, { trajectoryTail: traj, signature: "s", sourceIds: ["f1"] } as never).length).toBe(1);
  });
  it("NO_LESSON 返回空且最多收2条", () => {
    expect(parseLessons("NO_LESSON", { trajectoryTail: traj, signature: "s", sourceIds: [] } as never).length).toBe(0);
    const three = good + "\n" + good.replace("先落盘再点名", "第二课") + "\n" + good.replace("先落盘再点名", "第三课");
    expect(parseLessons(three, { trajectoryTail: traj, signature: "s", sourceIds: [] } as never).length).toBeLessThanOrEqual(2);
  });
  it("同签名去重不新增", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-lesson-"));
    const base = { id: "l1", title: "t", description: "d", content: "c", polarity: "failure" as const, evidence: "e", signature: "sig-a", sourceIds: ["f1"], trustTier: 1 as const, stats: { injected: 0, wins: 0, losses: 0 }, createdAt: 1 };
    await appendLesson(dir, base);
    await appendLesson(dir, { ...base, id: "l2", sourceIds: ["f2"], createdAt: 2 });
    const all = await listLessons(dir);
    expect(all.length).toBe(1);
    expect(all[0]!.sourceIds).toContain("f1");
    expect(all[0]!.sourceIds).toContain("f2");
  });
});