import { expect, test } from "vitest";
import { recall } from "../../src/knowledge/recall.js";
import type { Capture } from "../../src/knowledge/capture-store.js";

function capture(input: Partial<Capture> & Pick<Capture, "id" | "raw">): Capture {
  return {
    id: input.id,
    source: input.source ?? "text",
    kind: input.kind ?? "note",
    raw: input.raw,
    summary: input.summary,
    tags: input.tags ?? [],
    projectId: input.projectId,
    citedFrom: input.citedFrom,
    createdAt: input.createdAt ?? 1,
    promoted: input.promoted ?? false,
  };
}

function depsFor(captures: Capture[]): { deps: { listCaptures: () => Promise<Capture[]> }; calls: () => number } {
  let calls = 0;
  return {
    deps: {
      async listCaptures() {
        calls++;
        return captures;
      },
    },
    calls: () => calls,
  };
}

test("recalls captures through raw-to-text adaptation with citations and sorted hits", async () => {
  const { deps, calls } = depsFor([
    capture({
      id: "c1",
      source: "text",
      raw: "A plain note mentions widget once in the body.",
    }),
    capture({
      id: "c2",
      source: "url",
      citedFrom: "https://example.test/widget",
      summary: "Widget field report",
      tags: ["widget"],
      raw: "Primary widget evidence keeps the widget keyword in raw text.",
    }),
    capture({
      id: "c3",
      source: "chat",
      tags: ["other"],
      raw: "This unrelated capture has no matching term.",
    }),
  ]);

  const hits = await recall("widget", deps);

  expect(calls()).toBe(1);
  expect(hits.map((hit) => hit.capture.id)).toEqual(["c2", "c1"]);
  expect(hits[0].score).toBeGreaterThan(hits[1].score);
  expect(hits[0].citation.source).toBe("https://example.test/widget");
  expect(hits[0].citation.snippet).toContain("widget keyword");
  expect(hits[0].citation.matchedTerms).toEqual(["widget"]);
});

test("returns empty arrays for empty query and empty captures without throwing", async () => {
  const withCaptures = depsFor([
    capture({
      id: "c1",
      raw: "widget exists here",
    }),
  ]);

  await expect(recall("", withCaptures.deps)).resolves.toEqual([]);
  await expect(recall("   ", withCaptures.deps)).resolves.toEqual([]);
  expect(withCaptures.calls()).toBe(2);

  const empty = depsFor([]);
  await expect(recall("widget", empty.deps)).resolves.toEqual([]);
  expect(empty.calls()).toBe(1);
});

test("passes limit through to retrieval while preserving retrieval ordering", async () => {
  const { deps, calls } = depsFor([
    capture({
      id: "c1",
      raw: "widget",
    }),
    capture({
      id: "c2",
      tags: ["widget"],
      raw: "tagged opening text",
    }),
    capture({
      id: "c3",
      summary: "widget title",
      raw: "widget widget in body",
    }),
    capture({
      id: "c4",
      raw: "widget widget widget widget widget",
    }),
  ]);

  const hits = await recall("widget", deps, { limit: 2 });

  expect(calls()).toBe(1);
  expect(hits).toHaveLength(2);
  expect(hits.map((hit) => hit.capture.id)).toEqual(["c3", "c2"]);
  expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
});
