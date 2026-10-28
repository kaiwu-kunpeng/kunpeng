import { expect, test } from "vitest";
import { retrieveCaptures } from "../../src/knowledge/retrieve.js";
import type { Capture } from "../../src/knowledge/retrieve.js";

const captures: Capture[] = [
  {
    id: "c1",
    source: "https://example.test/c1",
    title: "Field notes",
    text: "Intro before the useful part: red widget widget widget widget in one paragraph.",
  },
  {
    id: "c2",
    source: "file:///notes/c2.md",
    title: "Widget repair guide",
    text: "This note mentions one widget after the title.",
  },
  {
    id: "c3",
    source: "capture://tag-only",
    tags: ["widget"],
    text: "Tagged source text begins here and deliberately avoids the keyword.",
  },
  {
    id: "c4",
    source: "capture://none",
    title: "Unrelated",
    tags: ["misc"],
    text: "Nothing relevant appears here.",
  },
];

function ids(result: ReturnType<typeof retrieveCaptures>): string[] {
  return result.map((hit) => hit.capture.id);
}

test("recalls Chinese captures with tokenized BM25 hits and citations", () => {
  const corpus: Capture[] = [
    {
      id: "a",
      source: "url",
      text: "AI 产品真正的护城河是循环工程，而非模型调优",
    },
    {
      id: "b",
      source: "url",
      text: "今天天气不错，适合散步",
    },
  ];

  const result = retrieveCaptures("护城河 循环工程", corpus);

  expect(ids(result)[0]).toBe("a");
  expect(ids(result)).not.toContain("b");
  expect(result[0].citation.matchedTerms).toContain("护城河");
  expect(result[0].citation.snippet).toContain("护城河");
});

test("scores and sorts BM25 keyword hits with citations", () => {
  const result = retrieveCaptures("widget", captures, { snippetRadius: 8 });

  expect(ids(result)).not.toContain("c4");
  for (let i = 0; i < result.length - 1; i++) {
    expect(result[i].score).toBeGreaterThanOrEqual(result[i + 1].score);
  }

  const c1 = result.find((hit) => hit.capture.id === "c1");
  const c3 = result.find((hit) => hit.capture.id === "c3");
  expect(c1?.score).toBeGreaterThan(0);
  expect(c3?.score).toBeGreaterThan(0);
  expect(c1?.citation.source).toBe(c1?.capture.source);
  expect(c1?.citation.snippet).toContain("widget");
  expect(c1?.citation.snippet.startsWith("…")).toBe(true);
  expect(c3?.citation.source).toBe("capture://tag-only");
  expect(c3?.citation.matchedTerms).toEqual(["widget"]);
  expect(c3?.citation.snippet).toBe("Tagged source te…");
});

test("uses rare term IDF to rank more specific documents higher", () => {
  const corpus: Capture[] = [
    { id: "common-1", source: "s", text: "alpha alpha background" },
    { id: "common-2", source: "s", text: "alpha background" },
    { id: "rare", source: "s", text: "alpha zeta background" },
  ];

  const result = retrieveCaptures("alpha zeta", corpus, { limit: 0 });

  expect(ids(result)[0]).toBe("rare");
  expect(result[0].score).toBeGreaterThan(result.find((hit) => hit.capture.id === "common-1")?.score ?? 0);
  expect(result[0].citation.matchedTerms).toEqual(["alpha", "zeta"]);
});

test("adds title and exact tag weights without changing citation shape", () => {
  const titleWeighted = retrieveCaptures("moat", [
    { id: "plain", source: "s", text: "moat baseline" },
    { id: "title", source: "s", title: "moat strategy", text: "moat baseline" },
  ]);

  expect(ids(titleWeighted)[0]).toBe("title");
  expect(titleWeighted[0].score).toBeGreaterThan(titleWeighted[1].score);

  const tagWeighted = retrieveCaptures("产品", [
    { id: "tag", source: "s", tags: ["产品"], text: "tag only opening" },
    { id: "split-tag", source: "s", tags: ["AI产品"], text: "tag only opening" },
  ], { limit: 0 });

  expect(ids(tagWeighted)).toEqual(["tag"]);
  expect(tagWeighted[0].citation.matchedTerms).toEqual(["产品"]);
  expect(tagWeighted[0].citation.snippet).toBe("tag only opening");
});

test("deduplicates matched terms in query order", () => {
  const result = retrieveCaptures("red widget widget", captures);
  const c1 = result.find((hit) => hit.capture.id === "c1");

  expect(c1?.citation.matchedTerms).toEqual(["red", "widget"]);
});

test("applies limit while limit zero returns all hits", () => {
  const limited = retrieveCaptures("widget", captures, { limit: 2 });
  const unlimited = retrieveCaptures("widget", captures, { limit: 0 });
  const full = retrieveCaptures("widget", captures);

  expect(limited).toHaveLength(2);
  expect(ids(limited)).toEqual(ids(full).slice(0, 2));
  expect(unlimited).toHaveLength(3);
  expect(ids(unlimited)).toEqual(ids(full));
});

test("normalizes query tokens to lowercase", () => {
  const insensitive = retrieveCaptures("WIDGET", captures);

  expect(ids(insensitive)).toContain("c1");
  expect(ids(insensitive)).toContain("c2");
  expect(ids(insensitive)).toContain("c3");
});

test("uses capture id as deterministic final tie-break and returns stable structures", () => {
  const tied: Capture[] = [
    { id: "b", source: "b", text: "alpha" },
    { id: "a", source: "a", text: "alpha" },
  ];

  const first = retrieveCaptures("alpha", tied, { limit: 0 });
  const second = retrieveCaptures("alpha", tied, { limit: 0 });

  expect(ids(first)).toEqual(["a", "b"]);
  expect(second).toEqual(first);
});

test("returns empty arrays for empty and no-match queries", () => {
  expect(retrieveCaptures("", captures)).toEqual([]);
  expect(retrieveCaptures("   ", captures)).toEqual([]);
  expect(retrieveCaptures("zzz-nomatch", captures)).toEqual([]);
});

test("does not mutate captures or options", () => {
  const input: Capture[] = captures.map((capture) => ({
    ...capture,
    tags: capture.tags === undefined ? undefined : [...capture.tags],
  }));
  const before = structuredClone(input);
  const opts = { limit: 0, snippetRadius: 8, caseSensitive: false };
  const optsBefore = { ...opts };

  retrieveCaptures("red widget", input, opts);

  expect(input).toEqual(before);
  expect(opts).toEqual(optsBefore);
});
