import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gateDesignArtifacts } from "../../src/design/design-gate.js";
import { FakeTierProbe } from "../../src/design/tier-signals.js";

function tempOutDir(): string {
  return mkdtempSync(join(tmpdir(), "kunpeng-design-gate-anti-pattern-"));
}

function writeHtml(outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "starter.html"), "<!doctype html><html><body><main>ok</main></body></html>", "utf8");
}

test("passes canned anti-pattern hits into verdict without changing tier decision", async () => {
  const outDir = tempOutDir();
  writeHtml(outDir);
  const antiPatternHits = [{ id: "no-emoji-icon", rule: "禁 emoji 当图标,用 SVG" }];

  const cleanVerdict = await gateDesignArtifacts({ outDir, probe: new FakeTierProbe() });
  const verdict = await gateDesignArtifacts({
    outDir,
    probe: new FakeTierProbe({ antiPatternHits }),
  });

  expect(verdict.antiPatternHits).toEqual(antiPatternHits);
  expect(verdict.decision).toEqual(cleanVerdict.decision);

  const persisted = JSON.parse(readFileSync(join(outDir, "tier-gate.json"), "utf8"));
  expect(persisted.antiPatternHits).toEqual(antiPatternHits);
});
