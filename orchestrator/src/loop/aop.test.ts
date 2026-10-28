import { describe, expect, it } from "vitest";
import { parseAop } from "./aop.js";

const GOOD = [
  "# 卡片",
  "正文",
  "```aop",
  JSON.stringify({ goal: "抓数据", steps: [{ id: "s1", prompt: "抓取列表页", assert: "test -f out.json" }] }),
  "```",
].join("\n");

describe("parseAop", () => {
  it("解析第一个 aop 围栏", () => {
    const plan = parseAop(GOOD);
    expect(plan?.goal).toBe("抓数据");
    expect(plan?.steps.length).toBe(1);
    expect(plan?.steps[0].id).toBe("s1");
    expect(plan?.steps[0].assert).toContain("test -f");
  });

  it("无围栏 / JSON 坏 / 缺字段 → undefined", () => {
    expect(parseAop("# 没有 aop")).toBeUndefined();
    expect(parseAop("```aop\n{oops\n```")).toBeUndefined();
    expect(parseAop('```aop\n{"goal":"x"}\n```')).toBeUndefined();
  });
});