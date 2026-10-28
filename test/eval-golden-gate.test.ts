import { describe, expect, it } from "vitest";
import { harvestGoldenTask, runGoldenSuite } from "../src/verify/regression-suite.js";

describe("golden 回归门 v0", () => {
  it("harvest 对含验收命令的记录产出 GoldenTask", () => {
    const t = harvestGoldenTask({ flowId: "fA", requirement: "做X", acceptCmd: "npx vitest run test/x.test.ts" }, () => 1000);
    expect(t).not.toBeNull();
    expect(t!.id).toBe("fA");
    expect(t!.acceptCmd).toContain("vitest");
    expect(t!.harvestedAt).toBe(1000);
  });

  it("harvest 对缺验收命令的记录返回 null", () => {
    expect(harvestGoldenTask({ flowId: "fB", requirement: "做Y" }, () => 1)).toBeNull();
  });

  it("runGoldenSuite 对注定失败的验收命令报出 regression", async () => {
    const tasks = [
      { id: "ok1", requirement: "", acceptCmd: "true", harvestedAt: 0 },
      { id: "bad1", requirement: "", acceptCmd: "false", harvestedAt: 0 },
    ];
    const exec = async (cmd: string) => cmd === "true" ? { code: 0, stderr: "" } : { code: 1, stderr: "boom" };
    const r = await runGoldenSuite({ tasks, exec });
    expect(r.total).toBe(2);
    expect(r.passed).toBe(1);
    expect(r.regressions.map((x) => x.id)).toContain("bad1");
    expect(r.regressions[0].stderrTail).toContain("boom");
  });

  it("全绿时 regressions 为空", async () => {
    const r = await runGoldenSuite({ tasks: [{ id: "ok", requirement: "", acceptCmd: "true", harvestedAt: 0 }], exec: async () => ({ code: 0, stderr: "" }) });
    expect(r.regressions).toHaveLength(0);
  });
});