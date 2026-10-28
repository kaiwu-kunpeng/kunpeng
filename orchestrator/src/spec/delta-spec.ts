import { parseEars, type EarsRequirement } from "./ears.js";

export interface SpecDelta {
  added: EarsRequirement[];
  removed: EarsRequirement[];
  retained: EarsRequirement[];
}

function requirementKey(r: EarsRequirement): string {
  return `${(r.trigger ?? "").trim().toLowerCase()}||${r.response.trim().toLowerCase()}`;
}

function uniqueByRequirementKey(requirements: EarsRequirement[]): EarsRequirement[] {
  const seen = new Set<string>();
  const unique: EarsRequirement[] = [];

  for (const requirement of requirements) {
    const key = requirementKey(requirement);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(requirement);
  }

  return unique;
}

export function diffEarsSpecs(baseText: string, nextText: string): SpecDelta {
  const base = uniqueByRequirementKey(parseEars(baseText));
  const next = uniqueByRequirementKey(parseEars(nextText));
  const baseKeys = new Set(base.map(requirementKey));
  const nextKeys = new Set(next.map(requirementKey));

  return {
    added: next.filter((requirement) => !baseKeys.has(requirementKey(requirement))),
    removed: base.filter((requirement) => !nextKeys.has(requirementKey(requirement))),
    retained: next.filter((requirement) => baseKeys.has(requirementKey(requirement))),
  };
}

export function formatSpecDelta(delta: SpecDelta): string {
  return `+${delta.added.length} 新增 / -${delta.removed.length} 移除 / =${delta.retained.length} 保留`;
}
