export interface Funnel {
  generated: number;
  committed: number;
  inProd: number;
}

export function retention(f: Funnel): {
  commitRate: number;
  survivalRate: number;
  reworkRate: number;
} {
  return {
    commitRate: f.generated > 0 ? f.committed / f.generated : 0,
    survivalRate: f.generated > 0 ? f.inProd / f.generated : 0,
    reworkRate: f.committed > 0 ? (f.committed - f.inProd) / f.committed : 0,
  };
}
