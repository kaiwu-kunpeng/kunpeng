import type { AcceptEvidence } from "./flowstate.js";

export interface RedFirstEvidence {
  redFirst?: boolean;
  baselineGreen?: boolean;
}

type WithEvidence = { acceptEvidence?: AcceptEvidence } | null | undefined;

export function aggregateRedFirstEvidence(flow: WithEvidence, children: readonly WithEvidence[]): RedFirstEvidence {
  const own = flow?.acceptEvidence?.baseline;
  if (own) return own.passed ? { baselineGreen: true } : { redFirst: true };
  if (children.length === 0) return {};
  const baselines = children.map((child) => child?.acceptEvidence?.baseline);
  if (baselines.some((b) => b === undefined)) return {};
  return baselines.some((b) => b?.passed === true) ? { baselineGreen: true } : { redFirst: true };
}
