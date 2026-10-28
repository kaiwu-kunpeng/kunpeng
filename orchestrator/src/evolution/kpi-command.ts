import { exec } from "node:child_process";
import type { KpiProvider, ProductKpiSnapshot } from "./product-kpi.js";

export interface CommandKpiOpts {
  command: string;
  key: string;
  label: string;
  higherBetter: boolean;
  timeoutMs?: number;
}

export function parseKpiValue(stdout: string): number | null {
  const text = stdout.trim();
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*(%)?\s*$/);
  if (!match) return null;

  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return null;
  return match[2] === "%" ? raw / 100 : raw;
}

export function commandKpiProvider(opts: CommandKpiOpts): KpiProvider {
  return (repoRoot: string) => new Promise<ProductKpiSnapshot>((resolve, reject) => {
    exec(opts.command, {
      cwd: repoRoot,
      timeout: opts.timeoutMs ?? 120000,
      shell: "/bin/bash",
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      const value = parseKpiValue(stdout);
      if (value === null) {
        reject(new Error(`KPI command did not output a numeric value: ${opts.command}`));
        return;
      }

      resolve({
        key: opts.key,
        label: opts.label,
        value,
        higherBetter: opts.higherBetter,
        detail: opts.command,
      });
    });
  });
}
