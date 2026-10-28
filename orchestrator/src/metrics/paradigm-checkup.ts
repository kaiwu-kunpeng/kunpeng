import type { AutomationLevel } from "./automation-level.js";

export interface Checkup {
  distribution: { L1: number; L2: number; L3: number };
  total: number;
  l3Ratio: number;
}

export function checkup(levels: AutomationLevel[]): Checkup {
  const distribution = { L1: 0, L2: 0, L3: 0 };

  for (const level of levels) {
    distribution[level] += 1;
  }

  const total = levels.length;
  const l3Ratio = total === 0 ? 0 : distribution.L3 / total;

  return { distribution, total, l3Ratio };
}
