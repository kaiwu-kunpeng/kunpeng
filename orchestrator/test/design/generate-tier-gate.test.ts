import { describe, it, expect } from "vitest";
import { cliSource } from "../helpers/cli-source.js";

describe("design-loop --generate 接 tier-gate 硬门（源码级断言）", () => {
  const src = cliSource();

  it("generate 路径在写 index.html 后调用 gateDesignArtifacts 且 htmlFile 指向 index.html", () => {
    const idx = src.indexOf('name: "design-loop"');
    expect(idx).toBeGreaterThan(-1);
    const branch = src.slice(idx, idx + 20000);
    const gateIdx = branch.indexOf("gateDesignArtifacts");
    expect(gateIdx).toBeGreaterThan(-1);
    const call = branch.slice(gateIdx, gateIdx + 400);
    expect(call).toContain('htmlFile: "index.html"');
  });

  it("硬门 fail-closed：tier1AutoPass 为假时置非零退出码；探针缺失只跳过不中断", () => {
    const idx = src.indexOf('name: "design-loop"');
    const branch = src.slice(idx, idx + 20000);
    expect(branch).toContain("tier1AutoPass");
    expect(branch).toContain("exitCode");
    expect(branch).toContain("跳过硬门");
  });
});
