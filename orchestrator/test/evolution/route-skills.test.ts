import { describe, expect, it } from "vitest";
import { route } from "../../src/evolution/route.js";
import type { ProposedChange } from "../../src/loop/self-evolution.js";

const c = (target: string, text: string): ProposedChange => ({ target, text, source: "exp-1" });

describe("提案路由的 skills 去向（作者锁定）", () => {
  it("target=skills 进 skills；四去向守恒、保序；core 仍进 unrouted", () => {
    const input = [c("skills", "geo-answer"), c("conventions", "写测试先红"), c("upgrade", "升 vitest"), c("constitution/core.md", "改核心"), c("skills", "seo-audit"), c("nope", "x")];
    const r = route(input);
    expect(r.skills.map((x) => x.text)).toEqual(["geo-answer", "seo-audit"]);
    expect(r.conventions).toHaveLength(1);
    expect(r.upgrades).toHaveLength(1);
    expect(r.unrouted.map((x) => x.target)).toEqual(["constitution/core.md", "nope"]);
    expect(r.skills.length + r.conventions.length + r.upgrades.length + r.unrouted.length).toBe(input.length);
  });

  it("没有 skills 变更时 skills 为空数组，旧三去向不受影响", () => {
    const r = route([c("conventions", "a"), c("upgrade", "b")]);
    expect(r.skills).toEqual([]);
    expect(r.conventions).toHaveLength(1);
    expect(r.upgrades).toHaveLength(1);
  });
});