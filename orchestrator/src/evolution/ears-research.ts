import type { LearningDigest } from "./failure-digest.js";
import type { SelfEvoFinding } from "./self-evo-finding.js";
import type { Researcher } from "../research/types.js";
import { wrapUntrusted } from "../security/prompt-shield.js";

const DEFAULT_MAX_DIRECTIONS = 3;
const EARS_SCORE = 40;

function detailWithSuggestions(input: {
  source: string;
  summary: string;
  suggestedConvention?: string;
  suggestedUpgrade?: string;
}): string {
  const extras = [
    input.suggestedConvention
      ? `建议约定: ${wrapUntrusted(input.source, input.suggestedConvention)}`
      : undefined,
    input.suggestedUpgrade
      ? `建议升级: ${wrapUntrusted(input.source, input.suggestedUpgrade)}`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  const summary = wrapUntrusted(input.source, input.summary);
  return extras.length ? `${summary}\n\n${extras.join("\n")}` : summary;
}

export async function earsFindings(
  digest: LearningDigest,
  researcher: Researcher,
  opts: { maxDirections?: number } = {},
): Promise<SelfEvoFinding[]> {
  const maxDirections = opts.maxDirections ?? DEFAULT_MAX_DIRECTIONS;
  if (digest.directions.length === 0 || maxDirections <= 0) return [];

  const findings: SelfEvoFinding[] = [];

  for (const direction of digest.directions.slice(0, maxDirections)) {
    try {
      const researchFindings = await researcher.research(direction);
      for (const rf of researchFindings) {
        findings.push({
          channel: "ears",
          evidenceState: "untested",
          title: rf.suggestedUpgrade?.trim() || rf.topic,
          detail: detailWithSuggestions(rf),
          sources: rf.source ? [rf.source] : [],
          score: EARS_SCORE,
        });
      }
    } catch {
      continue;
    }
  }

  return findings;
}
