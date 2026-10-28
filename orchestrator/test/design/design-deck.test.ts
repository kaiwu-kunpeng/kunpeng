import { expect, test } from "vitest";

import {
  composeDeckPrompt,
  DECK_RULES,
  localeDirective,
} from "../../src/design/design-deck.js";

test("deck rules contain required anchors", () => {
  for (const anchor of ["16:9", "signature", "数据", "bullet"]) {
    expect(DECK_RULES).toContain(anchor);
  }
});

test("localeDirective supports bilingual and English deck directives", () => {
  expect(localeDirective("both")).toContain("中英");

  const english = localeDirective("en");
  expect(english).toContain("英");
  expect(english).not.toContain("中英");
});

test("composeDeckPrompt combines system prompt, deck rules, locale, and slides", () => {
  const prompt = composeDeckPrompt("SYS_X", { locale: "both", slides: 12 });

  expect(prompt).toContain("SYS_X");
  expect(prompt).toContain("幻灯片");
  expect(prompt).toContain("16:9");
  expect(prompt).toContain("中英");
  expect(prompt).toContain("12");
  expect(prompt.indexOf("# 幻灯片(PPT)生成")).toBeGreaterThan(
    prompt.indexOf("SYS_X"),
  );
});

test("composeDeckPrompt defaults to Chinese locale and ten slides", () => {
  expect(() => composeDeckPrompt("SYS_X")).not.toThrow();

  const prompt = composeDeckPrompt("SYS_X");
  expect(prompt).toContain("10");
  expect(prompt).toContain("全中文");
});
