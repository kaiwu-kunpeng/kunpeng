import { expect, test } from "vitest";
import { ingestText, type IngestDeps } from "../../src/knowledge/ingest.js";
import { newCapture } from "../../src/knowledge/capture-store.js";

function depsWithSummary(summary: Awaited<ReturnType<IngestDeps["summarize"]>>): IngestDeps {
  return {
    summarize: async () => summary,
    fetchUrl: async (url) => `BODY:${url}`,
    readFile: async (path) => `FILE:${path}`,
    now: () => 1718000000000,
    newId: () => "cap-category",
  };
}

test("ingestText preserves category returned by summarize", async () => {
  const capture = await ingestText("x", depsWithSummary({ summary: "s", tags: ["a"], category: "技术" }));

  expect(capture.category).toBe("技术");
  expect(capture.summary).toBe("s");
  expect(capture.tags).toEqual(["a"]);
});

test("ingestText remains compatible when summarize omits category", async () => {
  const capture = await ingestText("x", depsWithSummary({ summary: "s", tags: ["a"] }));

  expect(capture.category).toBeUndefined();
  expect(capture.summary).toBe("s");
  expect(capture.tags).toEqual(["a"]);
});

test("newCapture stores optional category from input", () => {
  const capture = newCapture(
    { source: "text", kind: "note", raw: "r", category: "产品" },
    { now: () => 1718000000000, id: () => "cap-new" },
  );

  expect(capture.category).toBe("产品");
});
