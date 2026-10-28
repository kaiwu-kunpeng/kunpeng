import { expect, test } from "vitest";

import {
  ARCHETYPES,
  brandContextMd,
  brandVoiceDirective,
  buildBrandContext,
  getArchetype,
} from "../../src/design/brand-stage.js";

test("lists the 12 Jung archetypes and finds them deterministically", () => {
  expect(ARCHETYPES).toHaveLength(12);
  expect(getArchetype("ruler")?.name).toContain("统治者");
  expect(getArchetype("无")).toBeUndefined();
});

test("builds explicit and default brand contexts", () => {
  const ctx = buildBrandContext({
    name: "鲲鹏",
    archetypeId: "ruler",
    pillars: ["自主", "可信", "精密"],
    neverSay: ["颠覆性", "赋能"],
    tone: {
      funnySerious: 1,
      casualFormal: 1,
      irreverentRespectful: 1,
      enthusiasticMatter: 1,
    },
  });

  expect(ctx.archetypeId).toBe("ruler");
  expect(ctx.pillars).toHaveLength(3);

  const fallback = buildBrandContext({ name: "x" });

  expect(fallback.archetypeId).toBe("sage");
  expect(fallback.pillars).toEqual([]);
  expect(fallback.neverSay).toEqual([]);
  expect(fallback.tone).toEqual({
    funnySerious: 0,
    casualFormal: 0,
    irreverentRespectful: 0,
    enthusiasticMatter: 0,
  });
});

test("renders brand context markdown and voice directives", () => {
  const ctx = buildBrandContext({
    name: "鲲鹏",
    archetypeId: "ruler",
    mission: "让自主系统可信地完成复杂工作",
    pillars: ["自主", "可信", "精密"],
    neverSay: ["颠覆性", "赋能"],
    tone: {
      funnySerious: 1,
      casualFormal: 1,
      irreverentRespectful: 1,
      enthusiasticMatter: 1,
    },
  });

  const md = brandContextMd(ctx);

  expect(md).toContain("鲲鹏");
  expect(md).toContain("统治者");
  expect(md).toContain("精密");
  expect(md).toContain("赋能");

  const directive = brandVoiceDirective(ctx);

  expect(directive).toContain("禁说");
  expect(directive).toContain("赋能");
  expect(directive).toContain("掌控");
});
