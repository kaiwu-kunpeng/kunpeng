import { expect, test } from "vitest";
import { scanModuleHealth } from "../src/evolution/module-health.js";
import type { ModuleStatus } from "../src/status/types.js";

function m(over: Partial<ModuleStatus>): ModuleStatus {
  return { id: "x", name: "X", category: "ops", light: "green", wired: true, ...over };
}

test("健康(green/idle 且已接线)模块不产生 finding", () => {
  const out = scanModuleHealth([m({ light: "green" }), m({ id: "i", name: "I", light: "idle" })]);
  expect(out).toEqual([]);
});

test("黄灯(信息态:陈旧/有未读/在线)不再产生待审 finding——只上仪表盘", () => {
  const out = scanModuleHealth([m({ id: "y", name: "Y", light: "yellow" })]);
  expect(out).toEqual([]);
});

test("红灯(故障)产生 module 通道 finding，evidenceState=untested，score 高", () => {
  const out = scanModuleHealth([
    m({ id: "r", name: "R", light: "red" }),
    m({ id: "y", name: "Y", light: "yellow" }),
  ]);
  expect(out.length).toBe(1);
  expect(out[0].channel).toBe("module");
  expect(out[0].title).toContain("R");
  expect(out[0].evidenceState).toBe("untested");
  expect(out[0].score).toBeGreaterThan(60);
});

test("未接线(wired=false)模块照常产生未接线 finding，sources 含 module:id", () => {
  const out = scanModuleHealth([m({ id: "u", name: "U", light: "green", wired: false })]);
  expect(out.length).toBe(1);
  expect(out[0].channel).toBe("module");
  expect(out[0].title).toContain("未接线");
  expect(out[0].sources).toContain("module:u");
});

test("黄灯但未接线 → 仍产未接线 finding(未接线优先于灯色去噪)", () => {
  const out = scanModuleHealth([m({ id: "yu", name: "YU", light: "yellow", wired: false })]);
  expect(out.length).toBe(1);
  expect(out[0].title).toContain("未接线");
});

test("既未接线又红灯 → 两条 finding(含未接线 + 一条高分红灯)", () => {
  const out = scanModuleHealth([m({ id: "b", name: "B", light: "red", wired: false })]);
  expect(out.length).toBe(2);
  expect(out.some((x) => x.title.includes("未接线"))).toBe(true);
  expect(out.some((x) => x.score >= 80)).toBe(true);
  expect(out.every((x) => x.sources.includes("module:b"))).toBe(true);
});

test("不修改传入数组", () => {
  const input = [m({ id: "r", name: "R", light: "red" })];
  const snapshot = JSON.stringify(input);
  scanModuleHealth(input);
  expect(JSON.stringify(input)).toBe(snapshot);
});
