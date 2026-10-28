import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { shouldShareSpec } from "../../src/cli-commands/flywheel-eval.js";

describe("shouldShareSpec：默认不共享 spec", () => {
  it("空参数默认 false —— 每个候选各跑自己的 spec 以保留多样性", () => {
    expect(shouldShareSpec([])).toBe(false);
  });

  it("显式 --share-spec 才为 true", () => {
    expect(shouldShareSpec(["--share-spec"])).toBe(true);
  });

  it("与其它参数混排时仍能识别", () => {
    expect(shouldShareSpec(["--n", "3", "--share-spec", "--repo", "/x"])).toBe(true);
  });

  it("近似写法不得误判为真", () => {
    expect(shouldShareSpec(["--share"])).toBe(false);
    expect(shouldShareSpec(["--share-specs"])).toBe(false);
    expect(shouldShareSpec(["share-spec"])).toBe(false);
    expect(shouldShareSpec(["--Share-Spec"])).toBe(false);
  });

  it("只有 --n 时为 false", () => {
    expect(shouldShareSpec(["--n", "2"])).toBe(false);
  });
});

describe("接线：runSpecOnce 必须是条件展开", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../src/cli-commands/flywheel-eval.ts"),
    "utf8",
  );

  it("调用点用 shouldShareSpec 判定", () => {
    expect(src).toContain("shouldShareSpec(context.rest)");
  });

  it("runSpecOnce 不再无条件传入", () => {
    // 原写法是紧跟 n 之后直接 `runSpecOnce:`；改造后必须包在条件展开里
    expect(src).not.toMatch(/\n\s*n,\n\s*runSpecOnce:/);
  });
});