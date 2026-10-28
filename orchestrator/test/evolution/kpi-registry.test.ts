import { describe, it, expect } from "vitest";
import { resolveKpiProvider } from "../../src/evolution/kpi-registry.js";
import { autonomyKpiProvider } from "../../src/evolution/kpi-autonomy.js";
import type { KpiProvider } from "../../src/evolution/product-kpi.js";

describe("resolveKpiProvider 按项目解析 B-provider", () => {
  it("kunpeng → autonomy provider", () => {
    expect(resolveKpiProvider("kunpeng")).toBe(autonomyKpiProvider);
  });
  it("acme-shop → 仅从项目配置注入命令式 provider", () => {
    const provider: KpiProvider = async () => ({
      key: "configured",
      label: "configured",
      value: 1,
      higherBetter: true,
    });
    expect(resolveKpiProvider("acme-shop", { "acme-shop": provider })).toBe(provider);
    expect(resolveKpiProvider("acme-shop")).toBe(autonomyKpiProvider);
  });
  it("未注册项目/无 projectId → 缺省 autonomy(逃逸率 git 通用)", () => {
    expect(resolveKpiProvider("some-unregistered-proj")).toBe(autonomyKpiProvider);
    expect(resolveKpiProvider(undefined)).toBe(autonomyKpiProvider);
  });
  it("返回的是可调用 provider", () => {
    expect(typeof resolveKpiProvider("kunpeng")).toBe("function");
  });
});
