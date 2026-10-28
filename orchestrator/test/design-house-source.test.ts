import { expect, test } from "vitest";
import type { DesignSource, DesignContract } from "../src/design/contract.js";
import {
  HOUSE_PRESETS,
  HouseDefaultSource,
  housePresetSources,
} from "../src/design/house-source.js";

/** 解析全部 house 预设来源，取出其契约（resolve 为 async，返回候选 → 契约）。 */
async function resolveAll(): Promise<DesignContract[]> {
  const sources: DesignSource[] = housePresetSources();
  const candidates = await Promise.all(
    sources.map((s) => s.resolve({ kind: "house" })),
  );
  return candidates.map((c) => c.contract);
}

test("HOUSE_PRESETS 是 neutral / slate / stone 三套基色预设，长度为 3", () => {
  expect(HOUSE_PRESETS.length).toBe(3);
  expect([...HOUSE_PRESETS]).toEqual(["neutral", "slate", "stone"]);
});

test("housePresetSources() 返回 3 个 source", () => {
  expect(housePresetSources().length).toBe(3);
});

test("HouseDefaultSource 默认预设为 neutral，id 为 house:<preset>", () => {
  expect(new HouseDefaultSource().id).toBe("house:neutral");
  expect(new HouseDefaultSource("slate").id).toBe("house:slate");
});

test("每个候选的 source 等于其来源 id（source === this.id）", async () => {
  const sources = housePresetSources();
  for (const s of sources) {
    const cand = await s.resolve({ kind: "house" });
    expect(cand.source).toBe(s.name);
    expect(cand.contract.source).toBe(s.name);
  }
});

test("3 份契约的 source 互不相同", async () => {
  const ids = (await resolveAll()).map((c) => c.source);
  expect(new Set(ids).size).toBe(3);
});

test("每份契约 anchor 含 shadcn、components 非空、tokens.colors 非空", async () => {
  for (const c of await resolveAll()) {
    expect(c.anchor).toContain("shadcn");
    expect(c.components.length).toBeGreaterThan(0);
    expect(Object.keys(c.tokens.colors).length).toBeGreaterThan(0);
  }
});

test("3 个 tokens.colors.background 不全相同（预设确有差异）", async () => {
  const bgs = (await resolveAll()).map((c) => c.tokens.colors.background);
  expect(new Set(bgs).size).toBeGreaterThan(1);
});

test("契约满足完整接口约定：spacing 有键、typography 含 Geist、固定 5 组件", async () => {
  for (const c of await resolveAll()) {
    expect(Object.keys(c.tokens.spacing).length).toBeGreaterThan(0);
    expect(Object.values(c.tokens.typography).join(" ")).toContain("Geist");
    expect(c.components).toEqual(["Button", "Card", "Input", "Dialog", "Tabs"]);
  }
});
