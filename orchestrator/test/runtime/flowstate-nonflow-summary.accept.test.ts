import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { describeSkippedNonFlowFiles, FlowTracker, resetSkippedStateFileWarnings } from "../../src/runtime/flowstate.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-nonflow-")); resetSkippedStateFileWarnings(); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("非流状态文件汇总告警（作者锁定）", () => {
  test("150 个业务记录文件：一次 list 只告警一行（带计数与示例），再 list 不再告警；真流照读", async () => {
    const tracker = new FlowTracker(dir);
    await tracker.start("flow-real", "需求");
    for (let i = 0; i < 150; i += 1) {
      writeFileSync(join(dir, `loop-demo-model-expand-P${String(i).padStart(3, "0")}.json`), JSON.stringify({ enum: `P${i}`, at: "2026-07-25" }));
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect((await tracker.list()).map((f) => f.flowId)).toEqual(["flow-real"]);
      expect((await tracker.list()).map((f) => f.flowId)).toEqual(["flow-real"]);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0]![0]);
      expect(line).toContain("150 个非流状态文件");
      expect(line).toContain("loop-demo-model-expand-P000.json");
      expect(line).toContain(dir);
    } finally {
      warn.mockRestore();
    }
  });

  test("损坏的流文件（JSON 写坏）仍逐个告警，不被汇总吞掉", async () => {
    const tracker = new FlowTracker(dir);
    writeFileSync(join(dir, "broken-flow.json"), "{ 写坏了");
    writeFileSync(join(dir, "biz-a.json"), JSON.stringify({ enum: "A" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await tracker.list();
      const lines = warn.mock.calls.map((c) => String(c[0]));
      expect(lines).toHaveLength(2);
      expect(lines.some((l) => l.includes("流状态文件损坏") && l.includes("broken-flow.json"))).toBe(true);
      expect(lines.some((l) => l.includes("1 个非流状态文件") && l.includes("biz-a.json"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  test("汇总函数：空列表不报；同一目录只报一次；不同目录各报一次；reset 后重新报", () => {
    expect(describeSkippedNonFlowFiles("/a", [])).toBeUndefined();
    expect(describeSkippedNonFlowFiles("/a", ["x.json", "y.json"])).toBe("[flowstate] /a 下有 2 个非流状态文件，已跳过（如 x.json）");
    expect(describeSkippedNonFlowFiles("/a", ["x.json"])).toBeUndefined();
    expect(describeSkippedNonFlowFiles("/b", ["z.json"])).toContain("/b");
    resetSkippedStateFileWarnings();
    expect(describeSkippedNonFlowFiles("/a", ["x.json"])).toContain("1 个非流状态文件");
  });
});