import { describe, expect, test } from "vitest";
import { resumeFrom, shouldRerun } from "../../src/runtime/idempotent.js";

describe("resumeFrom", () => {
  test("skips completed stages and resumes at the first remaining stage", () => {
    expect(resumeFrom(["spec", "impl", "verify"], ["spec"])).toEqual({
      skip: ["spec"],
      remaining: ["impl", "verify"],
      next: "impl",
      done: false,
    });
  });

  test("marks the plan done when all stages are completed", () => {
    expect(resumeFrom(["spec", "impl", "verify"], ["spec", "impl", "verify"])).toEqual({
      skip: ["spec", "impl", "verify"],
      remaining: [],
      next: null,
      done: true,
    });
  });

  test("returns all stages as remaining when nothing is completed", () => {
    expect(resumeFrom(["spec", "impl", "verify"], [])).toEqual({
      skip: [],
      remaining: ["spec", "impl", "verify"],
      next: "spec",
      done: false,
    });
  });

  test("ignores unknown completed stages and deduplicates all stages", () => {
    expect(resumeFrom(["spec", "impl", "impl", "verify"], ["unknown", "impl"])).toEqual({
      skip: ["impl"],
      remaining: ["spec", "verify"],
      next: "spec",
      done: false,
    });
  });

  test("does not mutate input arrays", () => {
    const allStages = ["spec", "impl", "verify"];
    const completedStages = ["spec"];
    const beforeAllStages = [...allStages];
    const beforeCompletedStages = [...completedStages];

    resumeFrom(allStages, completedStages);

    expect(allStages).toEqual(beforeAllStages);
    expect(completedStages).toEqual(beforeCompletedStages);
  });
});

describe("shouldRerun", () => {
  test("does not rerun completed stages by default", () => {
    expect(shouldRerun("spec", ["spec"])).toBe(false);
  });

  test("reruns incomplete stages", () => {
    expect(shouldRerun("impl", ["spec"])).toBe(true);
  });

  test("forceStages overrides completed stages", () => {
    expect(shouldRerun("spec", ["spec"], { forceStages: ["spec"] })).toBe(true);
  });

  test("does not mutate input arrays or options", () => {
    const completedStages = ["spec"];
    const opts = { forceStages: ["verify"] };
    const beforeCompletedStages = [...completedStages];
    const beforeOpts = { forceStages: [...opts.forceStages] };

    shouldRerun("spec", completedStages, opts);

    expect(completedStages).toEqual(beforeCompletedStages);
    expect(opts).toEqual(beforeOpts);
  });
});
