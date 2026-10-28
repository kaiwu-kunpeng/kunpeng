import { clientSource } from "../helpers/client-source.js";
import { httpSource } from "../helpers/http-source.js";
import { projectViewsSource } from "../helpers/project-views-source.js";
import { describe, it, expect } from "vitest";
import { designPreviewArgs } from "../../src/server/launch.js";

describe("designPreviewArgs", () => {
  it("基础与带预设形态", () => {
    expect(designPreviewArgs("/repo")).toEqual(["design-preview", "--repo", "/repo"]);
    expect(designPreviewArgs("/repo", { sources: "house,claude", preset: "linear-dark" }))
      .toEqual(["design-preview", "--repo", "/repo", "--sources", "house,claude", "--preset", "linear-dark"]);
    expect(designPreviewArgs("/repo", { preset: "" })).toEqual(["design-preview", "--repo", "/repo"]);
  });
});

describe("候选/预设入口接线（源码级断言）", () => {
  it("http.ts 两端点在场且 presets 端点调 listDesignPresets", () => {
    const src = httpSource();
    const pv = src.indexOf('"/api/design-preview"');
    const ps = src.indexOf('"/api/design-presets"');
    expect(pv).toBeGreaterThan(-1);
    expect(ps).toBeGreaterThan(-1);
    expect(src.slice(pv, pv + 2000)).toContain("designPreviewArgs");
    expect(src.slice(ps, ps + 2000)).toContain("listDesignPresets");
  });

  it("设计 tab 有生成候选按钮与预设下拉；client 有分发分支", () => {
    const view = projectViewsSource();
    expect(view).toContain('data-action="design-preview"');
    expect(view).toContain("data-design-preset");
    const client = clientSource();
    expect(client).toContain('action === "design-preview"');
    expect(client).toContain("/api/design-presets");
  });
});
