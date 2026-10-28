import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { scanAntiPatterns } from "./anti-pattern-scan.js";
import type { AntiPatternHit } from "./anti-pattern-scan.js";
import { aggregateTierSignals } from "./tier-signals.js";
import type { TierSignalProbe, RawTierSignals } from "./tier-signals.js";
import { pickProbe } from "./tier-probe.js";
import { pickCapturer } from "./capturers.js";
import { baselineExists, baselinePath, captureBaseline } from "./baseline-store.js";
import type { ScreenshotCapturer } from "./screenshot.js";
import { twoTierDecision } from "../verify/tier-gate.js";
import type { TierGateInput, TierGateResult } from "../verify/tier-gate.js";

export interface DesignGateVerdict {
  signals: RawTierSignals;
  input: TierGateInput;
  decision: TierGateResult;
  antiPatternHits: AntiPatternHit[];
}

export interface GateDesignOptions {
  outDir: string;
  probe?: TierSignalProbe;
  upstream?: { buildPassed: boolean; behaviorPassed: boolean };
  htmlFile?: string;
  baseline?: boolean;
  repoRoot?: string;
  baselineKey?: string;
  capturer?: ScreenshotCapturer;
  baselineChanged?: boolean;
  html?: string;
  css?: string;
}

export async function gateDesignArtifacts(opts: GateDesignOptions): Promise<DesignGateVerdict> {
  const htmlPath = join(opts.outDir, opts.htmlFile ?? "starter.html");
  const html = await readFile(htmlPath, "utf8");

  let repoRoot: string | undefined;
  let key: string | undefined;
  let exists = false;
  let probeOpts = {};
  if (opts.baseline) {
    repoRoot = opts.repoRoot ?? dirname(dirname(opts.outDir));
    key = opts.baselineKey ?? "starter";
    exists = await baselineExists(repoRoot, key);
    if (exists) {
      probeOpts = {
        playwright: {
          baselinePath: baselinePath(repoRoot, key),
          baselineChanged: opts.baselineChanged,
        },
      };
    }
  }

  const probe = opts.probe ?? pickProbe(probeOpts);
  const signals = await probe.probe({ html });

  if (opts.baseline && repoRoot && key && !exists) {
    try {
      await captureBaseline(repoRoot, key, html, opts.capturer ?? pickCapturer());
    } catch {
      // Baseline capture is opportunistic; the gate verdict remains authoritative.
    }
  }

  const input = aggregateTierSignals(
    signals,
    opts.upstream ?? { buildPassed: true, behaviorPassed: true },
  );
  const decision = twoTierDecision(input);
  const antiPatternHits =
    signals.antiPatternHits ?? scanAntiPatterns({ html: opts.html ?? html, css: opts.css ?? html });
  const verdict: DesignGateVerdict = { signals, input, decision, antiPatternHits };
  await writeFile(join(opts.outDir, "tier-gate.json"), JSON.stringify(verdict, null, 2), "utf8");
  return verdict;
}
