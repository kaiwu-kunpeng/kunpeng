import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodegraphIndex } from "../../src/codegraph/index-cmd.js";

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "cgidx-"));
  writeFileSync(join(repo, "a.ts"), "export function login(){ validate(); }\nfunction validate(){}\n");
  writeFileSync(join(repo, "AGENTS.md"), "# rules\n");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("indexes repo, persists graph.json, injects AGENTS.md", async () => {
  const stats = await runCodegraphIndex(repo);
  expect(stats.nodes).toBeGreaterThan(0);
  expect(existsSync(join(repo, ".kunpeng", "codegraph", "graph.json"))).toBe(true);
  expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("codegraph_context");
});