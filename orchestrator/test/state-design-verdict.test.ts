import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readDesignVerdict } from "../src/server/state.js";

describe("readDesignVerdict", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "kp-design-verdict-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function writeTierGate(value: unknown) {
    const outDir = path.join(dir, ".kunpeng", "design-code");
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "tier-gate.json"), typeof value === "string" ? value : JSON.stringify(value), "utf8");
  }

  test("完整 tier-gate.json 可被正确投影", async () => {
    await writeTierGate({
      signals: { ignored: true },
      input: {
        buildPassed: true,
        behaviorPassed: true,
        a11yGateable: true,
        perfWithinBudget: true,
        visualMatchesBaseline: true,
        hasNewOrChangedBaseline: true,
      },
      decision: {
        tier1AutoPass: false,
        needsHumanReview: true,
        blockers: [],
      },
    });

    await expect(readDesignVerdict(dir)).resolves.toEqual({
      tier1AutoPass: false,
      needsHumanReview: true,
      blockers: [],
      a11yGateable: true,
      perfWithinBudget: true,
      visualMatchesBaseline: true,
      hasNewOrChangedBaseline: true,
    });
  });

  test("blocker 场景保留 blocker 并投影 a11yGateable=false", async () => {
    await writeTierGate({
      input: {
        a11yGateable: false,
        perfWithinBudget: true,
        visualMatchesBaseline: true,
        hasNewOrChangedBaseline: false,
      },
      decision: {
        tier1AutoPass: false,
        needsHumanReview: false,
        blockers: ["a11y 不可门"],
      },
    });

    const verdict = await readDesignVerdict(dir);
    expect(verdict?.blockers).toContain("a11y 不可门");
    expect(verdict?.a11yGateable).toBe(false);
  });

  test("缺文件返回 undefined 且不抛", async () => {
    await expect(readDesignVerdict(dir)).resolves.toBeUndefined();
  });

  test("非 JSON 坏档返回 undefined 且不抛", async () => {
    await writeTierGate("not json");

    await expect(readDesignVerdict(dir)).resolves.toBeUndefined();
  });

  test("缺少 decision 或 input 返回 undefined", async () => {
    await writeTierGate({});

    await expect(readDesignVerdict(dir)).resolves.toBeUndefined();
  });
});
