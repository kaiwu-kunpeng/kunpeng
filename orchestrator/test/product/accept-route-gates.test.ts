import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { canAcceptStage, draftStage, initState, isProductStage } from "../../src/product/stage-machine.js";
import { decideSpecAcceptance } from "../../src/product/accept-gate.js";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server", "routes", "product-build.ts"),
  "utf8",
);

describe("isProductStage 运行时白名单", () => {
  it("合法阶段为 true", () => {
    for (const s of ["define", "spec", "design", "build", "validate"]) {
      expect(isProductStage(s), s).toBe(true);
    }
  });

  it("非法输入一律 false", () => {
    expect(isProductStage("foo")).toBe(false);
    expect(isProductStage("")).toBe(false);
    expect(isProductStage(undefined)).toBe(false);
    expect(isProductStage(1)).toBe(false);
  });
});

describe("canAcceptStage 前置判定", () => {
  it("非法 stage 给出非法产品阶段", () => {
    const state = initState("demo", "想法", 1000);
    const out = canAcceptStage(state, "foo");
    expect(out.ok).toBe(false);
    expect(out.reason).toContain("非法产品阶段");
  });

  it("未起草阶段给出阶段未起草", () => {
    const state = initState("demo", "想法", 1000);
    expect(state.stages.build.status).toBe("pending");
    const out = canAcceptStage(state, "build");
    expect(out.ok).toBe(false);
    expect(out.reason).toContain("阶段未起草");
  });

  it("drafted 阶段放行", () => {
    const state = draftStage(initState("demo", "想法", 1000), "spec", "spec.md", 1500);
    expect(canAcceptStage(state, "spec").ok).toBe(true);
  });

  it("不抛错且不改写入参", () => {
    const state = initState("demo", "想法", 1000);
    const snapshot = JSON.stringify(state);
    expect(() => canAcceptStage(state, "foo")).not.toThrow();
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

const failing = {
  pass: false,
  issues: [
    { field: "problem", problem: "过短" },
    { field: "stories", problem: "缺失" },
    { field: "problem", problem: "套话" },
  ],
};

describe("decideSpecAcceptance 具体性门", () => {
  it("通过则放行且非覆盖", () => {
    const out = decideSpecAcceptance({ concreteness: { pass: true, issues: [] }, humanOverride: false });
    expect(out.allowed).toBe(true);
    expect(out.overridden).toBe(false);
    expect(out.blockedFields).toEqual([]);
  });

  it("不通过且无覆盖则拒绝，字段去重保序", () => {
    const out = decideSpecAcceptance({ concreteness: failing, humanOverride: false });
    expect(out.allowed).toBe(false);
    expect(out.blockedFields).toEqual(["problem", "stories"]);
    expect(out.message).toContain("具体性门未通过");
  });

  it("显式覆盖则放行并标记", () => {
    const out = decideSpecAcceptance({ concreteness: failing, humanOverride: true });
    expect(out.allowed).toBe(true);
    expect(out.overridden).toBe(true);
    expect(out.message).toContain("人工覆盖");
  });
});

describe("路由确实消费了三道门", () => {
  it("三道门都出现在路由里", () => {
    expect(routeSrc).toContain("canAcceptStage");
    expect(routeSrc).toContain("assessConcreteness");
    expect(routeSrc).toContain("decideSpecAcceptance");
  });

  it("门都在 acceptStageWithCheckpoint 之前", () => {
    const acceptIdx = routeSrc.indexOf("acceptStageWithCheckpoint(repoRoot");
    expect(acceptIdx).toBeGreaterThan(-1);
    expect(routeSrc.indexOf("canAcceptStage")).toBeLessThan(acceptIdx);
    expect(routeSrc.indexOf("decideSpecAcceptance")).toBeLessThan(acceptIdx);
  });

  it("返回 409 且覆盖会落审计", () => {
    expect(routeSrc).toContain("409");
    expect(routeSrc).toContain("product-accept-override");
  });
});