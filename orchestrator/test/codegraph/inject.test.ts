import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEGRAPH_BEGIN, CODEGRAPH_END, codegraphAgentsSection, injectIntoAgentsMd } from "../../src/codegraph/inject.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "inj-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("section lists the four tools and the discipline", () => {
  const s = codegraphAgentsSection();
  for (const t of ["codegraph_search", "codegraph_callers", "codegraph_callees", "codegraph_context"]) {
    expect(s).toContain(t);
  }
  expect(s).toContain(CODEGRAPH_BEGIN);
  expect(s).toContain(CODEGRAPH_END);
});

test("appends into an existing AGENTS.md preserving prior content", () => {
  const f = join(dir, "AGENTS.md");
  writeFileSync(f, "# existing rules\nkeep me\n");
  injectIntoAgentsMd(f);
  const out = readFileSync(f, "utf8");
  expect(out).toContain("keep me");
  expect(out).toContain("codegraph_callers");
});

test("is idempotent: two runs leave exactly one codegraph block", () => {
  const f = join(dir, "AGENTS.md");
  writeFileSync(f, "# rules\n");
  injectIntoAgentsMd(f);
  injectIntoAgentsMd(f);
  const out = readFileSync(f, "utf8");
  const begins = out.split(CODEGRAPH_BEGIN).length - 1;
  const ends = out.split(CODEGRAPH_END).length - 1;
  expect(begins).toBe(1);
  expect(ends).toBe(1);
});

test("creates the section even if the file does not exist yet", () => {
  const f = join(dir, "new-AGENTS.md");
  injectIntoAgentsMd(f);
  expect(readFileSync(f, "utf8")).toContain("codegraph_context");
});