// 确定性 a11y（axe）违规摘要器。按 impact 严重度聚合成四级计数，
// 并给出"能否作为确定性门"的判定：门只硬拦 critical/serious，其余留人审
//（约 43% 无障碍问题机器测不出，见研究结论）。纯函数，无 I/O、无随机（C8）。

export interface AxeViolation {
  id: string;
  impact?: string;
}

export interface AxeSummary {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  gateable: boolean;
}

export function summarizeAxe(violations: AxeViolation[]): AxeSummary {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations) {
    if (v.impact && v.impact in counts) {
      counts[v.impact as keyof typeof counts] += 1;
    }
  }
  return {
    ...counts,
    gateable: counts.critical === 0 && counts.serious === 0,
  };
}
