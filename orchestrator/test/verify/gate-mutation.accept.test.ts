import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GATE_MUTATIONS, runGateMutations } from "../../src/verify/gate-mutation.js";

const TABLE = new URL("../../src/verify/gate-survivors.json", import.meta.url);

describe("门变异打枪：漏网集合必须与已知幸存表完全相等", () => {
  it("实际漏网 == 幸存表（变松 → 新漏网红；修好不删表 → 也红）", async () => {
    const results = await runGateMutations();
    expect(results.map((r) => r.id)).toEqual(GATE_MUTATIONS.map((m) => m.id));
    const survivors = results.filter((r) => !r.caught).map((r) => r.id).sort();
    const table = JSON.parse(readFileSync(TABLE, "utf8")) as string[];
    expect(survivors).toEqual(table);
  }, 120_000);

  it("幸存表有序、无重复、每个 id 都在样本库里", () => {
    const table = JSON.parse(readFileSync(TABLE, "utf8")) as string[];
    expect([...table].sort()).toEqual(table);
    expect(new Set(table).size).toBe(table.length);
    const ids = new Set(GATE_MUTATIONS.map((m) => m.id));
    for (const id of table) expect(ids.has(id)).toBe(true);
  });

  it("样本库覆盖四类门且数量不少于下限", () => {
    const count = (gate: string): number => GATE_MUTATIONS.filter((m) => m.gate === gate).length;
    expect(count("verification")).toBeGreaterThanOrEqual(6);
    expect(count("new-failures")).toBeGreaterThanOrEqual(4);
    expect(count("sensitive")).toBeGreaterThanOrEqual(20);
    expect(count("evaluator")).toBeGreaterThanOrEqual(3);
    expect(new Set(GATE_MUTATIONS.map((m) => m.id)).size).toBe(GATE_MUTATIONS.length);
  });

  it("关键样本 id 原样存在", () => {
    const ids = GATE_MUTATIONS.map((m) => m.id);
    for (const id of [
      "verification:nonfinal-line",
      "verification:pipe-mask",
      "verification:semicolon-mask",
      "sensitive:orchestrator/package.json",
      "sensitive:orchestrator/src/verify/gate-survivors.json",
      "sensitive:orchestrator/test/verify/gate-mutation.accept.test.ts",
      "sensitive:orchestrator/src/loop/audit.ts",
      "evaluator:upper",
    ]) {
      expect(ids).toContain(id);
    }
  });
});