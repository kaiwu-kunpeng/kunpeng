import { describe, expect, test } from "vitest";
import type { ProposedChange } from "../src/loop/self-evolution.js";
import { route } from "../src/evolution/route.js";

const c = (target: string, text = "t", source = "exp-1"): ProposedChange => ({ target, text, source });

describe("route — 进化提案按目标分派 (纯函数, C8)", () => {
  test("conventions 目标 → conventions 去向", () => {
    const r = route([c("conventions")]);
    expect(r.conventions).toHaveLength(1);
    expect(r.upgrades).toEqual([]);
    expect(r.unrouted).toEqual([]);
  });

  test("upgrade 目标 → upgrades 去向", () => {
    const r = route([c("upgrade")]);
    expect(r.upgrades).toHaveLength(1);
    expect(r.conventions).toEqual([]);
    expect(r.unrouted).toEqual([]);
  });

  test("未知目标 → unrouted（不静默丢弃）", () => {
    const r = route([c("something-unknown")]);
    expect(r.unrouted).toHaveLength(1);
    expect(r.conventions).toEqual([]);
    expect(r.upgrades).toEqual([]);
  });

  test("禁区兜底优先级最高：targetForbidden 命中 → unrouted（压过其它匹配）", () => {
    // core / 角色卡落禁区，即便它们不是 conventions/upgrade 也必须进 unrouted
    expect(route([c("constitution/core.md")]).unrouted).toHaveLength(1);
    expect(route([c("core")]).unrouted).toHaveLength(1);
    expect(route([c("constitution/roles/implementer.md")]).unrouted).toHaveLength(1);
  });

  test("守恒：四去向长度之和 = 入参长度", () => {
    const input = [
      c("conventions"),
      c("upgrade"),
      c("core"),
      c("mystery"),
      c("conventions"),
    ];
    const r = route(input);
    expect(r.conventions.length + r.upgrades.length + r.skills.length + r.unrouted.length).toBe(input.length);
  });

  test("保序：每个去向内部保持入参相对顺序", () => {
    const a = c("conventions", "a");
    const b = c("conventions", "b");
    const r = route([a, c("upgrade"), b]);
    expect(r.conventions).toEqual([a, b]);
  });

  test("纯函数：不改入参、空入参得空去向", () => {
    const input = [c("conventions")];
    const snapshot = JSON.parse(JSON.stringify(input));
    route(input);
    expect(input).toEqual(snapshot);
    expect(route([])).toEqual({ conventions: [], upgrades: [], skills: [], unrouted: [] });
  });

  test("混合输入：各归各位且元素引用原样转移", () => {
    const conv = c("conventions");
    const up = c("upgrade");
    const forbidden = c("constitution/core.md");
    const unknown = c("whatever");
    const r = route([conv, forbidden, up, unknown]);
    expect(r.conventions).toEqual([conv]);
    expect(r.upgrades).toEqual([up]);
    expect(r.unrouted).toEqual([forbidden, unknown]);
  });
});