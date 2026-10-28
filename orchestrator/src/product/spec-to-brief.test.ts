import { describe, expect, test } from "vitest";
import { BANNED_TONE_WORDS, REQUIRED_FIELDS } from "../design/brief-gate.js";
import { specToBrief } from "./spec-to-brief.js";
import type { ProductDefinition } from "./contract.js";

const def: ProductDefinition = {
  idea: "研发指挥仪表盘",
  problem: "技术创始人无法 3 秒判断系统健康",
  jobStatement: "当系统异常时创始人想快速定位以便止损",
  users: ["技术创始人", "运维"],
  stories: ["一眼看到红灯", "点开看根因"],
  acceptance: ["3 秒内可判读系统状态"],
  nonGoals: ["不做完整 APM"],
};

describe("specToBrief", () => {
  test("maps definition into a complete DesignBrief", () => {
    const b = specToBrief(def);
    expect(b.projectType).toBe("研发指挥仪表盘");
    expect(b.audience).toContain("技术创始人");
    expect(b.mustHave).toEqual(["一眼看到红灯", "点开看根因"]);
    expect(b.forbidden).toEqual(["不做完整 APM"]);
    expect(b.successMetric).toBe("3 秒内可判读系统状态");
    expect(b.locale).toBe("zh");
  });

  test("all REQUIRED_FIELDS are non-empty", () => {
    const b = specToBrief(def) as unknown as Record<string, unknown>;
    for (const f of REQUIRED_FIELDS) {
      const v = b[f];
      const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
      expect(empty, `field ${f} must be non-empty`).toBe(false);
    }
  });

  test("tone never contains a banned empty-word", () => {
    const b = specToBrief(def);
    const tone = b.tone.toLowerCase();
    for (const w of BANNED_TONE_WORDS) expect(tone.includes(w.toLowerCase())).toBe(false);
  });

  test("empty definition still yields safe non-empty required fields", () => {
    const b = specToBrief({ idea: "", problem: "", users: [], stories: [], acceptance: [] }) as unknown as Record<string, unknown>;
    for (const f of REQUIRED_FIELDS) {
      const v = b[f];
      const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
      expect(empty, `field ${f} must be non-empty`).toBe(false);
    }
  });
});
