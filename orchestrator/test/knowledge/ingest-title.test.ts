import { expect, test } from "vitest";
import { ingestUrl, type IngestDeps } from "../../src/knowledge/ingest.js";
import { newCapture } from "../../src/knowledge/capture-store.js";

function depsWithSummary(summary: Awaited<ReturnType<IngestDeps["summarize"]>>): IngestDeps {
  return {
    summarize: async () => summary,
    fetchUrl: async (url) => `BODY:${url}`,
    readFile: async (path) => `FILE:${path}`,
    now: () => 1718000000000,
    newId: () => "cap-title",
  };
}

test("ingestUrl preserves title returned by summarize", async () => {
  const capture = await ingestUrl(
    "https://example.test/a",
    depsWithSummary({ summary: "s", tags: ["a"], title: "真实标题" }),
  );

  expect(capture.title).toBe("真实标题");
  expect(capture.summary).toBe("s");
  expect(capture.tags).toEqual(["a"]);
});

test("ingestUrl remains compatible when summarize omits title", async () => {
  const capture = await ingestUrl("https://example.test/a", depsWithSummary({ summary: "s", tags: ["a"] }));

  expect(capture.title).toBeUndefined();
  expect(capture.summary).toBe("s");
  expect(capture.tags).toEqual(["a"]);
});

test("newCapture stores optional title from input", () => {
  const capture = newCapture(
    { source: "url", kind: "url", raw: "r", title: "T" },
    { now: () => 1718000000000, id: () => "cap-new-title" },
  );

  expect(capture.title).toBe("T");
});
