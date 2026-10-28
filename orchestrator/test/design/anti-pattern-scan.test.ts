import { expect, test } from "vitest";
import { scanAntiPatterns } from "../../src/design/anti-pattern-scan.js";

function hitIds(code: { css?: string; html?: string }): string[] {
  return scanAntiPatterns(code).map((hit) => hit.id);
}

test("detects purple gradient CSS", () => {
  expect(hitIds({ css: "background: linear-gradient(#8b5cf6, #6366f1)" })).toContain(
    "no-purple-gradient",
  );
});

test("returns no hits for clean CSS with compliant transition", () => {
  expect(scanAntiPatterns({ css: "color:#0f3d3e;transition: all 200ms" })).toEqual([]);
});

test("detects emoji icons in HTML", () => {
  expect(hitIds({ html: "<button>🚀 提交</button>" })).toContain("no-emoji-icon");
});

test("detects default primary font families", () => {
  expect(hitIds({ css: "font-family: Inter, sans-serif" })).toContain("no-default-font");
});

test("does not flag custom primary font families", () => {
  expect(hitIds({ css: 'font-family: "Cormorant Garamond", serif' })).not.toContain(
    "no-default-font",
  );
});

test("detects removed focus outline without focus-visible fallback", () => {
  expect(hitIds({ css: ".button:focus{outline:none}" })).toContain("a11y-focus");
});

test("does not flag removed outline when focus-visible exists", () => {
  expect(
    hitIds({ css: ".button:focus{outline:none}.button:focus-visible{outline:2px solid}" }),
  ).not.toContain("a11y-focus");
});

test("detects zero millisecond transition", () => {
  expect(hitIds({ css: "transition: all 0ms" })).toContain("motion-150-300");
});

test("detects transition longer than 500ms", () => {
  expect(hitIds({ css: "transition: all 800ms" })).toContain("motion-150-300");
});

test("does not flag compliant transition duration", () => {
  expect(hitIds({ css: "transition: all 250ms" })).not.toContain("motion-150-300");
});

test("detects three blur usages", () => {
  expect(
    hitIds({ css: "filter:blur(2px);backdrop-filter:blur(4px);box-shadow:0 0 blur(1px)" }),
  ).toContain("no-blur-everywhere");
});

test("does not flag one blur usage", () => {
  expect(hitIds({ css: "filter:blur(2px)" })).not.toContain("no-blur-everywhere");
});

test("dingbat-not-flag: ✓✗ 状态符不误报,真 emoji 仍报", () => {
  expect(scanAntiPatterns({ html: "<span>✓ 已采纳</span><span>✗ 失败</span>" }).some(h => h.id === "no-emoji-icon")).toBe(false);
  expect(scanAntiPatterns({ html: "<button>🚀 上线</button>" }).some(h => h.id === "no-emoji-icon")).toBe(true);
  expect(scanAntiPatterns({ html: "<i>⚡ fast</i>" }).some(h => h.id === "no-emoji-icon")).toBe(true);
});
