import { describe, expect, test } from "vitest";
import { confirmRegressions } from "../../src/verify/diff-confirm.js";

/** 真实抖动行:happy-dom 在 vitest 环境 teardown 时中断在飞 fetch 打出来的,同一份代码每跑条数都不同。 */
const FLAKE = "DOMException [AbortError]: The operation was aborted.";
const REAL = "src/foo.ts(3,1): error TS2304: Cannot find name 'bar'.";

describe("差分门复验", () => {
  test("第一跑没发现回归 → 不复验,零额外开销", async () => {
    let reran = 0;
    const result = await confirmRegressions(
      { baseline: "✓ ok", after: "✓ ok" },
      async () => { reran += 1; return { baseline: "", after: "" }; },
    );
    expect(result).toEqual({ regressions: [], flakes: [] });
    expect(reran).toBe(0);
  });

  test("抖动行:基线那跑没打、实现后那跑打了,复验时基线打出来了 → 判为抖动不拦", async () => {
    const result = await confirmRegressions(
      { baseline: "✓ ok", after: `✓ ok\n${FLAKE}` },
      async () => ({ baseline: `✓ ok\n${FLAKE}`, after: `✓ ok\n${FLAKE}` }),
    );
    expect(result.regressions).toEqual([]);
    expect(result.flakes).toEqual([FLAKE]);
  });

  test("抖动行:复验时实现后那跑没打 → 同样判为抖动", async () => {
    const result = await confirmRegressions(
      { baseline: "✓ ok", after: `✓ ok\n${FLAKE}` },
      async () => ({ baseline: "✓ ok", after: "✓ ok" }),
    );
    expect(result.regressions).toEqual([]);
    expect(result.flakes).toEqual([FLAKE]);
  });

  test("真回归:两跑都复现 → 照样拦下", async () => {
    const result = await confirmRegressions(
      { baseline: "✓ ok", after: `✓ ok\n${REAL}` },
      async () => ({ baseline: "✓ ok", after: `✓ ok\n${REAL}` }),
    );
    expect(result.regressions).toEqual([REAL]);
    expect(result.flakes).toEqual([]);
  });

  test("真回归与抖动混在一起 → 只拦真的,抖动进 flakes", async () => {
    const result = await confirmRegressions(
      { baseline: "✓ ok", after: `${FLAKE}\n${REAL}` },
      async () => ({ baseline: `✓ ok\n${FLAKE}`, after: `${FLAKE}\n${REAL}` }),
    );
    expect(result.regressions).toEqual([REAL]);
    expect(result.flakes).toEqual([FLAKE]);
  });

  test("基线取并集:第一跑基线有的行,复验时不再被判成回归", async () => {
    const result = await confirmRegressions(
      { baseline: "✓ ok", after: `✓ ok\n${REAL}` },
      async () => ({ baseline: `✓ ok\n${REAL}`, after: `✓ ok\n${REAL}` }),
    );
    expect(result.regressions).toEqual([]);
    expect(result.flakes).toEqual([REAL]);
  });
});

describe("接线到位:两道门都用了复验", () => {
  test("集成检查门与逐流差分门都调 confirmRegressions,且不再直接调 newFailures", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const file of ["../../src/plan/orchestrator.ts", "../../src/loop/dev-cycle.ts"]) {
      const source = await readFile(new URL(file, import.meta.url), "utf8");
      expect(source, `${file} 应调 confirmRegressions`).toContain("confirmRegressions");
      expect(source, `${file} 不应再直接调 newFailures`).not.toMatch(/\bnewFailures\(/);
    }
  });

  test("逐流差分门的基线取了两跑并集", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../../src/loop/dev-cycle.ts", import.meta.url), "utf8");
    expect(source).toMatch(/baselines\.set\(cmd, `\$\{first\}\\n\$\{second\}`\)/);
  });
});