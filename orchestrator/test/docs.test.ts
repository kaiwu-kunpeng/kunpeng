import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { compileDocs } from "../src/compile/docs.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-docs-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("docs index lists artifacts grouped by kind", async () => {
  const store = new ArtifactStore(join(dir, "artifacts"));
  await store.write({ kind: "spec", id: "s1", status: "verified", body: "# Build login\n...", meta: {} });
  await store.write({ kind: "experience", id: "e1", status: "draft", body: "flow s1 → verified", meta: {} });
  const out = join(dir, "DOCS.md");
  const text = await compileDocs(store, out);
  expect(text).toContain("## spec");
  expect(text).toContain("s1");
  expect(text).toContain("## experience");
  expect(text).toContain("e1");
  expect(readFileSync(out, "utf8")).toContain("文档索引");
});
