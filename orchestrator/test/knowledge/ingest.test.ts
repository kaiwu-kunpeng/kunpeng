import { expect, test } from "vitest";
import { ingest, ingestFile, ingestText, ingestUrl } from "../../src/knowledge/ingest.js";
import type { IngestDeps } from "../../src/knowledge/ingest.js";

function makeDeps(): IngestDeps {
  return {
    summarize: async (raw) => ({
      summary: `S:${raw.slice(0, 8)}`,
      tags: ["a", "a", "b"],
    }),
    fetchUrl: async (url) => `BODY-OF:${url}`,
    readFile: async (path) => `FILE-OF:${path}`,
    now: () => 1718000000000,
    newId: () => "cap-1",
  };
}

test("ingestText 归一 inline text capture", async () => {
  const capture = await ingestText("hello world", makeDeps());

  expect(capture.source).toBe("text");
  expect(capture.origin).toBe("inline");
  expect(capture.raw).toBe("hello world");
  expect(capture.summary).toBe("S:hello wo");
  expect(capture.tags).toEqual(["a", "b"]);
  expect(capture.capturedAt).toBe(1718000000000);
  expect(capture.id).toBe("cap-1");
});

test("ingestUrl 使用注入 fetchUrl 的正文归一", async () => {
  const capture = await ingestUrl("https://x.test/a", makeDeps());

  expect(capture.source).toBe("url");
  expect(capture.origin).toBe("https://x.test/a");
  expect(capture.raw).toBe("BODY-OF:https://x.test/a");
  expect(capture.summary).toBe("S:BODY-OF:");
});

test("ingestFile 使用注入 readFile 的内容归一", async () => {
  const capture = await ingestFile("/tmp/note.md", makeDeps());

  expect(capture.source).toBe("file");
  expect(capture.origin).toBe("/tmp/note.md");
  expect(capture.raw).toBe("FILE-OF:/tmp/note.md");
});

test("ingest 统一入口正确分派到 URL 摄取", async () => {
  const deps = makeDeps();

  await expect(ingest({ kind: "url", url: "https://x.test/b" }, deps)).resolves.toEqual(
    await ingestUrl("https://x.test/b", deps),
  );
});

test("相同输入和相同注入 deps 输出稳定一致", async () => {
  const deps = makeDeps();

  await expect(ingestText("dup", deps)).resolves.toEqual(await ingestText("dup", deps));
});
