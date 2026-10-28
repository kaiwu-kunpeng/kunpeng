import { clientSource } from "../helpers/client-source.js";
import { httpSource } from "../helpers/http-source.js";
import { describe, it, expect } from "vitest";
import { renderProductStationLine } from "../../src/server/ui/views/project.js";

function loopWith(over: Record<string, unknown>): Parameters<typeof renderProductStationLine>[0] {
  return {
    slug: "demo",
    currentStage: "validate",
    stages: {},
    ...over,
  } as unknown as Parameters<typeof renderProductStationLine>[0];
}

describe("拾取上屏", () => {
  it("预览活着 → 出「选元素改」入口且带 kp-pick=1", () => {
    const html = renderProductStationLine(loopWith({
      preview: { alive: true, url: "http://localhost:4310", pid: 1, port: 4310, script: "dev", startedAt: 1 },
    }));
    expect(html).toContain("选元素改");
    expect(html).toContain("kp-pick=1");
  });

  it("有 picks → 已拾取列表与生成任务按钮在场", () => {
    const html = renderProductStationLine(loopWith({
      picks: [{ selector: "#hero > button", text: "立即开始", at: 5 }],
    }));
    expect(html).toContain("picked-elements");
    expect(html).toContain('data-action="product-pick-task"');
    expect(html).toContain("#hero &gt; button");
    expect(html).toContain("立即开始");
  });

  it("无预览无 picks → 两块都不出", () => {
    const html = renderProductStationLine(loopWith({}));
    expect(html.includes("kp-pick=1")).toBe(false);
    expect(html.includes("picked-elements")).toBe(false);
  });

  it("源级：client 源码 分支与 http 端点已接", () => {
    const client = clientSource();
    expect(client).toContain("product-pick-task");
    expect(client).toContain("/api/product/pick-task");
    const http = httpSource();
    expect(http).toContain("/api/product/pick-task");
  });
});
