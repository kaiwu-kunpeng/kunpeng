import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { CodeGraphStore } from "../../src/codegraph/store.js";
import { loadGraphStore, runCodegraphMcpStdio } from "../../src/codegraph/serve-cmd.js";

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "cgserve-")); });
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("loadGraphStore reads persisted graph.json", () => {
  const s = new CodeGraphStore();
  s.addNode({ id: "a", kind: "function", name: "login", file: "a.ts", line: 1 });
  s.addNode({ id: "b", kind: "function", name: "validate", file: "a.ts", line: 2 });
  s.addEdge({ from: "a", to: "b", kind: "calls" });
  mkdirSync(join(repo, ".kunpeng", "codegraph"), { recursive: true });
  writeFileSync(join(repo, ".kunpeng", "codegraph", "graph.json"), s.toJSON());

  const loaded = loadGraphStore(repo);
  expect(loaded.stats()).toEqual({ nodes: 2, edges: 1 });
});

test("loadGraphStore returns empty store when graph.json missing", () => {
  expect(loadGraphStore(repo).stats()).toEqual({ nodes: 0, edges: 0 });
});

test("stdio loop answers a tools/call over injected streams", async () => {
  const store = new CodeGraphStore();
  store.addNode({ id: "a", kind: "function", name: "login", file: "a.ts", line: 1 });
  store.addNode({ id: "b", kind: "function", name: "validate", file: "a.ts", line: 2 });
  store.addEdge({ from: "a", to: "b", kind: "calls" });

  const req = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "codegraph_callers", arguments: { name: "validate" } } });
  const chunks: string[] = [];
  const output = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });

  await runCodegraphMcpStdio(store, Readable.from([req + "\n"]), output);

  const out = chunks.join("");
  expect(out).toContain("login");
});