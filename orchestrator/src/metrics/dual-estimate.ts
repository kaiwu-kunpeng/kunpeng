export interface DualEstimate {
  origHours: number;
  aiEstHours: number;
  actualHours?: number;
}

export function computeRatios(e: DualEstimate): {
  compression: number;
  realization: number | null;
} {
  const compression = e.origHours <= 0 ? 0 : (e.origHours - e.aiEstHours) / e.origHours;

  if (e.actualHours === undefined) {
    return { compression, realization: null };
  }

  const savedEstimateHours = e.origHours - e.aiEstHours;
  const realization =
    savedEstimateHours <= 0 ? 0 : (e.origHours - e.actualHours) / savedEstimateHours;

  return { compression, realization };
}
