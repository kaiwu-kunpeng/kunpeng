import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { parseKpiValue, commandKpiProvider } from "../../src/evolution/kpi-command.js";

describe("parseKpiValue", () => {
  it("解析小数 / 百分比 / 末尾数字", () => {
    expect(parseKpiValue("0.62\n")).toBeCloseTo(0.62, 6);
    expect(parseKpiValue("coverage: 62%")).toBeCloseTo(0.62, 6);
    expect(parseKpiValue("活跃品类 19 / 30 = 0.6333")).toBeCloseTo(0.6333, 4);
  });
  it("无数值 → null", () => {
    expect(parseKpiValue("no number here")).toBeNull();
    expect(parseKpiValue("")).toBeNull();
  });
});

describe("commandKpiProvider", () => {
  it("命令输出数值 → 快照 value 正确", async () => {
    const snap = await commandKpiProvider({ command: "echo 0.62", key: "supplier-coverage", label: "已激活品类占比", higherBetter: true })(tmpdir());
    expect(snap.key).toBe("supplier-coverage");
    expect(snap.value).toBeCloseTo(0.62, 6);
    expect(snap.higherBetter).toBe(true);
  });
  it("命令无数值输出 → reject(让 maintain 优雅跳过 B)", async () => {
    await expect(commandKpiProvider({ command: "echo nonsense", key: "k", label: "K", higherBetter: true })(tmpdir())).rejects.toBeTruthy();
  });
});
