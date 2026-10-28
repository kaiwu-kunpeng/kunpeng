import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scheduledRoute } from "../src/agent/model-routing.js";
import { FlowTracker } from "../src/runtime/flowstate.js";

describe("模型自动调度+真实记录(作者验收)", () => {
  it("codex 写码段调度到 GPT-6 Astra 且带 effort,轻活段用 gpt-5.6 低档模型", () => {
    const impl = scheduledRoute("implement", "codex", {});
    expect(impl.model).toBe("gpt-6-astra");
    expect(impl.effort).toBeTruthy();
    const verify = scheduledRoute("verify", "codex", {});
    expect(verify.model).toMatch(/gpt-5\.6/);
    expect(verify.model).not.toBe(impl.model);
  });

  it("claude 主链保持 opus 不降档", () => {
    expect(scheduledRoute("implement", "claude", {}).model).toContain("opus");
  });

  it("KUNPENG_MODEL_ROUTE 环境覆盖生效", () => {
    const env = { KUNPENG_MODEL_ROUTE: JSON.stringify({ implement: { model: "gpt-5.6-terra", effort: "low" } }) };
    const r = scheduledRoute("implement", "codex", env);
    expect(r.model).toBe("gpt-5.6-terra");
    expect(r.effort).toBe("low");
  });

  it("坏 JSON 覆盖静默回退默认表", () => {
    const r = scheduledRoute("implement", "codex", { KUNPENG_MODEL_ROUTE: "{oops" });
    expect(r.model).toBe("gpt-6-astra");
  });

  it("FlowTracker.setStageModel 落盘 stageModels", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-ms-"));
    const t = new FlowTracker(dir);
    await t.start("f1", "r");
    await t.setStageModel("f1", "implement", "gpt-5.6-sol@xhigh");
    const raw = JSON.parse(await readFile(join(dir, "f1.json"), "utf8")) as { stageModels?: Record<string, string> };
    expect(raw.stageModels?.implement).toBe("gpt-5.6-sol@xhigh");
  });
});