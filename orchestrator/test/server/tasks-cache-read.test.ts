import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderTasks } from "../../src/server/ui/views/tasks.js";

const base = { id: "f-real", requirement: "真实流", status: "verified", project: { name: "kunpeng" }, tokensUsed: 202671, history: [{ stage: "implement" }, { stage: "verify" }] };

describe("任务台按阶段混合价计费并显示缓存读（作者锁定）", () => {
  it("有 stageTokens/stageModels 与 tokenQuad → 成本按阶段混合价、tokens 单元格带缓存读", () => {
    const html = renderTasks([{
      ...base,
      stageTokens: { spec: 16464, implement: 186207 },
      stageModels: { spec: "claude-opus-5", implement: "gpt-6-astra@xhigh" },
      tokenQuad: { input: 171533, output: 31138, cacheCreate: 62940, cacheRead: 2566325 },
    }]);
    expect(html).toContain('data-cache-read="2566325"');
    expect(html).toContain("缓存读 2,566,325");
    expect(html).toContain("5.83");
    expect(html).not.toContain("1.22");
  });

  it("没有这些字段 → 输出与旧口径一致：无缓存读标记，成本仍按 6 美元/百万", () => {
    const html = renderTasks([base]);
    expect(html).not.toContain('class="cache-read"');
    expect(html).toContain("1.22");
  });

  it("render-view 把三个字段传进任务台", () => {
    const src = readFileSync(fileURLToPath(new URL("../../src/server/ui/render-view.ts", import.meta.url)), "utf8");
    for (const key of ["stageTokens: flow.stageTokens", "stageModels: flow.stageModels", "tokenQuad: flow.tokenQuad"]) expect(src).toContain(key);
  });
});