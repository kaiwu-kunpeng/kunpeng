import { clientSource } from "../helpers/client-source.js";
import { httpSource } from "../helpers/http-source.js";
import { describe, it, expect } from "vitest";
import { renderProductStationLine } from "../../src/server/ui/views/project.js";

function loopWith(over: Record<string, unknown>) {
  return {
    slug: "demo",
    currentStage: "build",
    stages: {},
    ...over,
  } as unknown as Parameters<typeof renderProductStationLine>[0];
}

describe("一键验收接线", () => {
  it("工位渲染一键验收主按钮", () => {
    const html = renderProductStationLine(loopWith({}));
    expect(html).toContain('data-action="product-checkup"');
    expect(html).toContain("一键验收");
    expect(html).toContain('data-slug="demo"');
  });

  it("源级：端点与 client 分支在场且复用既有机制", () => {
    const http = httpSource();
    expect(http).toContain("/api/product/checkup");
    const checkupIdx = http.indexOf("/api/product/checkup");
    const seg = http.slice(checkupIdx, checkupIdx + 3000);
    expect(seg).toContain("qaWithFixTask");
    expect(seg).toContain("commitWorkspaceVersion");
    const client = clientSource();
    expect(client).toContain("product-checkup");
    expect(client).toContain("验收中");
  });
});
