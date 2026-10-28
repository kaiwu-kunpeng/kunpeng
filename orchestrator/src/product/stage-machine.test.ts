// orchestrator/src/product/stage-machine.test.ts
import { describe, expect, test } from "vitest";
import {
  PRODUCT_STAGES,
  initState,
  nextStage,
  draftStage,
  acceptStage,
  resetToStage,
} from "./stage-machine.js";

describe("stage-machine", () => {
  test("initState: define drafted, others pending, current=define", () => {
    const s = initState("my-slug", "我的想法", 1000);
    expect(s.slug).toBe("my-slug");
    expect(s.idea).toBe("我的想法");
    expect(s.currentStage).toBe("define");
    expect(s.stages.define.status).toBe("drafted");
    expect(s.stages.spec.status).toBe("pending");
    expect(s.stages.design.status).toBe("pending");
  });

  test("nextStage walks define→spec→design→build→validate→undefined", () => {
    expect(nextStage("define")).toBe("spec");
    expect(nextStage("spec")).toBe("design");
    expect(nextStage("design")).toBe("build");
    expect(nextStage("build")).toBe("validate");
    expect(nextStage("validate")).toBeUndefined();
  });

  test("draftStage marks stage drafted + sets current + stamps time", () => {
    const s0 = initState("s", "i", 1000);
    const s1 = draftStage(s0, "spec", ".kunpeng/product/s/spec.md", 2000);
    expect(s1.stages.spec.status).toBe("drafted");
    expect(s1.stages.spec.artifactPath).toBe(".kunpeng/product/s/spec.md");
    expect(s1.stages.spec.updatedAt).toBe(2000);
    expect(s1.currentStage).toBe("spec");
    expect(s0.stages.spec.status).toBe("pending");
  });

  test("acceptStage marks accepted + advances current to next", () => {
    const s0 = draftStage(initState("s", "i", 1000), "spec", "p", 2000);
    const s1 = acceptStage(s0, "spec", 3000);
    expect(s1.stages.spec.status).toBe("accepted");
    expect(s1.currentStage).toBe("design");
  });

  test("acceptStage on last stage keeps current (no next)", () => {
    const s0 = draftStage(initState("s", "i", 1000), "validate", "p", 2000);
    const s1 = acceptStage(s0, "validate", 3000);
    expect(s1.stages.validate.status).toBe("accepted");
    expect(s1.currentStage).toBe("validate");
  });

  test("PRODUCT_STAGES is the canonical order", () => {
    expect([...PRODUCT_STAGES]).toEqual(["define", "spec", "design", "build", "validate"]);
  });

  test("build 是 design 之后", () => {
    expect(PRODUCT_STAGES).toEqual(["define", "spec", "design", "build", "validate"]);
    expect(nextStage("design")).toBe("build");
    expect(nextStage("build")).toBe("validate");
  });

  test("initState 含 build:pending", () => {
    const s = initState("slug-x", "想法", 1000);
    expect(s.stages.build).toEqual({ status: "pending", artifactPath: "", updatedAt: 1000 });
  });

  test("validate 是 build 之后的末段", () => {
    expect(PRODUCT_STAGES).toEqual(["define", "spec", "design", "build", "validate"]);
    expect(nextStage("build")).toBe("validate");
    expect(nextStage("validate")).toBeUndefined();
  });

  test("initState 含 validate:pending", () => {
    expect(initState("s", "i", 1).stages.validate).toEqual({ status: "pending", artifactPath: "", updatedAt: 1 });
  });

  test("resetToStage 把 currentStage 拨回指定段并置 drafted", () => {
    const s = initState("s", "i", 1);
    const r = resetToStage(s, "spec", "spec.md", 2);
    expect(r.currentStage).toBe("spec");
    expect(r.stages.spec.status).toBe("drafted");
    expect(r.stages.spec.artifactPath).toBe("spec.md");
  });
});
