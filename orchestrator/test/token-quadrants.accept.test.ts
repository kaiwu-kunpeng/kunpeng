import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { readWeeklyFlows } from "../src/metrics/flow-failures.js";

describe("token 四象限落盘(作者验收)", () => {
  it("addTokenQuad 逐键累加且忽略非法值", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-tq-"));
    const t = new FlowTracker(dir);
    await t.start("f1", "测试流");
    await t.addTokenQuad("f1", { input: 100, cacheRead: 800 });
    await t.addTokenQuad("f1", { input: 50, output: 200, cacheCreate: 30, cacheRead: -5 });
    const s = await t.read("f1");
    expect(s?.tokenQuad).toEqual({ input: 150, output: 200, cacheCreate: 30, cacheRead: 800 });
  });
  it("weekly 读取 tokenQuad", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-tq2-"));
    await writeFile(join(dir, "f2.json"), JSON.stringify({
      flowId: "f2", status: "verified", updatedAt: 900,
      tokenQuad: { input: 10, output: 20, cacheCreate: 5, cacheRead: 65 },
    }));
    const flows = await readWeeklyFlows(dir);
    const f = flows.find((x) => (x as { id?: string; flowId?: string }).id === "f2" || (x as { flowId?: string }).flowId === "f2");
    expect(f?.tokens?.cacheRead).toBe(65);
    expect(f?.tokens?.input).toBe(10);
  });
});