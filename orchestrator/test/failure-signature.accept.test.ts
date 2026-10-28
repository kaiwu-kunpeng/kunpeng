import { describe, expect, it } from "vitest";
import { failureSignature, clusterFailures } from "../src/metrics/failure-signature.js";

describe("失败签名归组(作者验收)", () => {
  it("时间戳/planId/路径/行列号归一", () => {
    const a = failureSignature("2026-07-12T03:44:00 plan-mrhabc12-ff00aa /Users/x/kunpeng/orchestrator/src/a.ts:12:34 编译失败 429");
    const b = failureSignature("2026-07-13T09:01:59 plan-zzz99-000bbb /Users/y/other/orchestrator/src/a.ts:99:1 编译失败 429");
    expect(a).toBe(b);
  });
  it("不同模式不合并", () => {
    expect(failureSignature("点名测试文件不存在 foo.test.ts")).not.toBe(failureSignature("tsc 类型错误 TS2345"));
  });
  it("聚类计数与排序", () => {
    const groups = clusterFailures([
      { id: "f1", reason: "错误A plan-a1-x" },
      { id: "f2", reason: "错误A plan-b2-y" },
      { id: "f3", reason: "错误B 独一份" },
    ]);
    expect(groups[0]!.count).toBe(2);
    expect(groups[0]!.ids).toEqual(["f1", "f2"]);
    expect(groups.length).toBe(2);
    expect(groups[0]!.sample).toContain("错误A");
  });
});