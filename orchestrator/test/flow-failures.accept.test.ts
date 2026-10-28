import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWeeklyFlows, readRecentFailureItems } from "../src/metrics/flow-failures.js";

async function mkState(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kp-ff-"));
}

describe("failures/weekly 真实数据形态(作者验收)", () => {
  it("weekly 跳过无 flowId 杂项文件不炸", async () => {
    const dir = await mkState();
    await writeFile(join(dir, "fitness-baseline.json"), JSON.stringify({ baseline: 1 }));
    await writeFile(join(dir, "ok-flow.json"), JSON.stringify({ flowId: "f1", status: "verified", updatedAt: 500 }));
    const flows = await readWeeklyFlows(dir);
    expect(flows.some((f) => f.id === "f1" || (f as { flowId?: string }).flowId === "f1")).toBe(true);
  });
  it("rolled-back 无顶层原因→从 logPath 尾部提取 reason=", async () => {
    const dir = await mkState();
    const logDir = join(dir, "logs");
    await mkdir(logDir, { recursive: true });
    const logPath = join(logDir, "x.log");
    await writeFile(logPath, "启动\n[warn] flow rolled-back · flowId=x reason=项目检查 [npm run test:unit] 引入基线之外的新问题\n收尾\n");
    await writeFile(join(dir, "x.json"), JSON.stringify({ flowId: "x", status: "rolled-back", stage: "verify", updatedAt: 900, logPath }));
    const items = await readRecentFailureItems(dir, 7, 1000);
    expect(items.length).toBe(1);
    expect(items[0]!.reason).toContain("项目检查");
  });
  it("无原因无日志也入列(阶段兜底话术)", async () => {
    const dir = await mkState();
    await writeFile(join(dir, "y.json"), JSON.stringify({ flowId: "y", status: "stopped", stage: "implement", updatedAt: 900 }));
    const items = await readRecentFailureItems(dir, 7, 1000);
    expect(items.length).toBe(1);
    expect(items[0]!.reason).toContain("implement");
  });
  it("时间窗外不入列", async () => {
    const dir = await mkState();
    await writeFile(join(dir, "z.json"), JSON.stringify({ flowId: "z", status: "rolled-back", stage: "verify", updatedAt: 1 }));
    const items = await readRecentFailureItems(dir, 7, 10_000_000_000);
    expect(items.length).toBe(0);
  });
});