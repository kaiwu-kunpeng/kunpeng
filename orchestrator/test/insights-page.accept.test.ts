import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { renderInsights } from "../src/server/ui/views/insights.js";

const uiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "server", "ui");

describe("洞察页(作者验收)", () => {
  it("三段渲染且含成本模型表", () => {
    const html = renderInsights({
      f07: undefined,
      savings: undefined,
      costSummary: { totalTokens: 1234, tokensByModel: { "gpt-5.6-sol@xhigh": 1000, "claude-opus-4-8": 234 } },
    } as never);
    expect(html).toContain("洞察");
    expect(html).toContain("gpt-5.6-sol@xhigh");
    expect(html).toContain("#/architecture");
    expect(html).toContain("#/evolution");
  });

  it("全空 state 不炸", () => {
    expect(renderInsights({} as never)).toContain("洞察");
  });

  it("路由/侧栏/白名单三处接线齐(组件≠接线)", () => {
    expect(readFileSync(join(uiDir, "render-view.ts"), "utf8")).toContain("renderInsights");
    expect(readFileSync(join(uiDir, "sidebar.ts"), "utf8")).toContain("#/insights");
    expect(clientSource()).toContain("#/insights");
  });
});