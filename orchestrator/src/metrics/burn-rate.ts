export interface BurnInput {
  spentUsd: number;
  budgetUsd: number;
  ratePerHourUsd: number;
}

export function hoursToCapacity(b: BurnInput): number | null {
  const remaining = b.budgetUsd - b.spentUsd;

  if (b.spentUsd >= b.budgetUsd) {
    return 0;
  }

  if (b.ratePerHourUsd <= 0) {
    return null;
  }

  return remaining / b.ratePerHourUsd;
}

export function willExceedWithin(b: BurnInput, hours: number): boolean {
  const capacityHours = hoursToCapacity(b);

  if (capacityHours === null) {
    return false;
  }

  return capacityHours <= hours;
}
