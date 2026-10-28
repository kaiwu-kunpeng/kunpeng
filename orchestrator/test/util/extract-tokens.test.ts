import { describe, expect, test } from "vitest";

import { extractTokensUsed } from "../../src/util/extract-tokens.js";

describe("extractTokensUsed", () => {
  test("extracts the real codex banner format and strips thousands separators", () => {
    expect(extractTokensUsed("codex\nok\ntokens used\n12,540\nok")).toBe(12540);
  });

  test("extracts numbers without thousands separators", () => {
    expect(extractTokensUsed("tokens used 980")).toBe(980);
  });

  test("returns undefined when the banner is missing", () => {
    expect(extractTokensUsed("just some output")).toBeUndefined();
  });

  test("returns the last match when multiple banners are present", () => {
    expect(extractTokensUsed("tokens used\n100\nmore output\ntokens used\n250")).toBe(250);
  });

  test("returns undefined for empty or noisy input without throwing", () => {
    expect(extractTokensUsed("")).toBeUndefined();
    expect(extractTokensUsed("tokens used\nnot a number")).toBeUndefined();
  });

  test("does not mutate the input string", () => {
    const input = "codex\nok\ntokens used\n12,540\nok";
    const before = input.slice();

    extractTokensUsed(input);

    expect(input).toBe(before);
  });
});
