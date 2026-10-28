import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { baselineExists, captureBaseline } from "../src/design/baseline-store.js";
import { gateDesignArtifacts } from "../src/design/design-gate.js";
import { FakeCapturer } from "../src/design/screenshot.js";
import { FakeTierProbe } from "../src/design/tier-signals.js";

function tempOutDir(): string {
  return mkdtempSync(join(tmpdir(), "kunpeng-design-gate-"));
}

function writeHtml(outDir: string, file = "starter.html"): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, file), "<!doctype html><html><body><main>ok</main></body></html>", "utf8");
}

function tempRepoRoot(): string {
  return mkdtempSync(join(tmpdir(), "kunpeng-design-gate-repo-"));
}

function designOutDir(repoRoot: string): string {
  return join(repoRoot, ".kunpeng", "design-code");
}

test("clean design artifacts produce new-baseline human review verdict and write tier-gate.json", async () => {
  const outDir = tempOutDir();
  writeHtml(outDir);

  const verdict = await gateDesignArtifacts({ outDir, probe: new FakeTierProbe() });

  expect(verdict.decision.needsHumanReview).toBe(true);
  expect(verdict.decision.tier1AutoPass).toBe(false);
  expect(verdict.decision.blockers).toEqual([]);

  const persisted = JSON.parse(readFileSync(join(outDir, "tier-gate.json"), "utf8"));
  expect(Object.keys(persisted).sort()).toEqual(["antiPatternHits", "decision", "input", "signals"]);
  expect(Object.keys(persisted.input).sort()).toEqual([
    "a11yGateable",
    "behaviorPassed",
    "buildPassed",
    "hasNewOrChangedBaseline",
    "perfWithinBudget",
    "visualMatchesBaseline",
  ]);
});

test("critical a11y violation produces a11y blocker", async () => {
  const outDir = tempOutDir();
  writeHtml(outDir);

  const verdict = await gateDesignArtifacts({
    outDir,
    probe: new FakeTierProbe({ axeViolations: [{ id: "image-alt", impact: "critical" }] }),
  });

  expect(verdict.decision.blockers).toContain("a11y 不可门");
});

test("upstream build failure is passed into the tier decision", async () => {
  const outDir = tempOutDir();
  writeHtml(outDir);

  const verdict = await gateDesignArtifacts({
    outDir,
    probe: new FakeTierProbe(),
    upstream: { buildPassed: false, behaviorPassed: true },
  });

  expect(verdict.decision.blockers).toContain("build 失败");
});

test("missing starter.html rejects with readFile failure", async () => {
  const outDir = tempOutDir();

  await expect(gateDesignArtifacts({ outDir, probe: new FakeTierProbe() })).rejects.toThrow();
});

test("htmlFile overrides the default starter.html artifact name", async () => {
  const outDir = tempOutDir();
  writeHtml(outDir, "page.html");

  const verdict = await gateDesignArtifacts({
    outDir,
    htmlFile: "page.html",
    probe: new FakeTierProbe(),
  });

  expect(verdict.decision.needsHumanReview).toBe(true);
  expect(readFileSync(join(outDir, "tier-gate.json"), "utf8")).toContain("\"decision\"");
});

test("baseline mode captures the first missing starter baseline and returns new-baseline review", async () => {
  const dir = tempRepoRoot();
  const outDir = designOutDir(dir);
  writeHtml(outDir);

  const verdict = await gateDesignArtifacts({
    outDir,
    repoRoot: dir,
    baseline: true,
    probe: new FakeTierProbe(),
    capturer: new FakeCapturer(),
  });

  expect(await baselineExists(dir, "starter")).toBe(true);
  expect(verdict.decision.needsHumanReview).toBe(true);
});

test("baseline mode uses visualDiff from an existing baseline for auto-pass decision", async () => {
  const dir = tempRepoRoot();
  const outDir = designOutDir(dir);
  writeHtml(outDir);
  await captureBaseline(dir, "starter", "<x/>", new FakeCapturer());

  const verdict = await gateDesignArtifacts({
    outDir,
    repoRoot: dir,
    baseline: true,
    probe: new FakeTierProbe({ visualDiff: { diffPixels: 0, totalPixels: 1000 } }),
    capturer: new FakeCapturer(),
  });

  expect(verdict.decision.tier1AutoPass).toBe(true);
});

test("without baseline mode design gate does not create design baselines", async () => {
  const dir = tempRepoRoot();
  const outDir = designOutDir(dir);
  writeHtml(outDir);

  const verdict = await gateDesignArtifacts({ outDir, probe: new FakeTierProbe() });

  expect(existsSync(join(dir, ".kunpeng", "design-baselines"))).toBe(false);
  expect(await baselineExists(dir, "starter")).toBe(false);
  expect(verdict.decision.needsHumanReview).toBe(true);
});
