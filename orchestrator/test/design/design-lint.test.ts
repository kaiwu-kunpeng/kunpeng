import { expect, test } from "vitest";
import { detectDefaultAesthetics, lintDesign } from "../../src/design/design-lint.js";

function rulesFor(css: string): string[] {
  return detectDefaultAesthetics({ css }).map((hit) => hit.rule);
}

test("returns no hits and zero counts for clean input", () => {
  expect(lintDesign({ css: ":root{--p:#2563eb}a{transition:all 200ms}" })).toEqual({
    hits: [],
    counts: { P0: 0, P1: 0, P2: 0 },
  });
});

test("detects cream background with serif type", () => {
  const hits = detectDefaultAesthetics({
    css: "body{background:#F4F1EA;font-family:Georgia,serif}",
  });

  expect(hits).toContainEqual(
    expect.objectContaining({ rule: "default-cream-serif", severity: "P0" }),
  );
});

test("ignores default aesthetic words echoed in html comments and body text", () => {
  expect(
    detectDefaultAesthetics({
      html: "<!-- palette: warm cream #F4F1EA with a high-contrast serif --><body><p>#F4F1EA with a serif</p><style>:root{--p:#2563eb}a{transition:all 200ms}</style></body>",
    }),
  ).toEqual([]);
});

test("detects cream serif inside html style blocks", () => {
  const hits = detectDefaultAesthetics({
    html: "<style>body{background:#F4F1EA;font-family:Georgia,serif}</style>",
  });

  expect(hits).toContainEqual(expect.objectContaining({ rule: "default-cream-serif" }));
});

test("detects near-black background with acid accent", () => {
  const hits = detectDefaultAesthetics({
    css: "body{background:#0a0a0a}.cta{color:#39ff14}",
  });

  expect(hits).toContainEqual(
    expect.objectContaining({ rule: "default-dark-acid", severity: "P0" }),
  );
});

test("detects broadsheet zero-radius hairline dense columns", () => {
  const hits = detectDefaultAesthetics({
    css: ".grid{column-count:4}*{border-radius:0}hr{border:1px solid #000}",
  });

  expect(hits).toContainEqual(
    expect.objectContaining({ rule: "default-broadsheet", severity: "P0" }),
  );
});

test("lintDesign reports severity counts that match hit length", () => {
  const report = lintDesign({
    css: "body{background:#0a0a0a}.cta{color:#39ff14}",
  });

  expect(report.counts.P0).toBeGreaterThanOrEqual(1);
  expect(report.hits.length).toBe(report.counts.P0 + report.counts.P1 + report.counts.P2);
});

test("covers required color variants and dense grid syntax", () => {
  expect(rulesFor("body{background:#f5f2ea;font-family:serif}")).toContain(
    "default-cream-serif",
  );
  expect(rulesFor("body{background:#111111}.cta{color:#FF4500}")).toContain(
    "default-dark-acid",
  );
  expect(
    rulesFor(".g{grid-template-columns:repeat(4,1fr)}*{border-radius:0px}hr{border-top: 1px solid #000}"),
  ).toContain("default-broadsheet");
});
