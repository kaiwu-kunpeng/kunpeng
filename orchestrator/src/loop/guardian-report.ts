export interface GuardianFindings {
  deadFlows?: string[];
  staleArtifacts?: string[];
  ghostGates?: string[];
  orphanWorktrees?: string[];
}

export interface GuardianSection {
  name: string;
  count: number;
  items: string[];
}

export interface GuardianReport {
  healthy: boolean;
  totalFindings: number;
  sections: GuardianSection[];
  summary: string;
}

type FindingKey = keyof GuardianFindings;

const SECTION_DEFS: Array<{ key: FindingKey; name: string }> = [
  { key: "deadFlows", name: "死流" },
  { key: "staleArtifacts", name: "陈旧产物" },
  { key: "ghostGates", name: "幽灵合并门" },
  { key: "orphanWorktrees", name: "孤儿worktree" },
];

export function buildGuardianReport(findings: GuardianFindings): GuardianReport {
  const sections = SECTION_DEFS.map(({ key, name }) => {
    const items = [...(findings[key] ?? [])];
    return {
      name,
      count: items.length,
      items,
    };
  });
  const totalFindings = sections.reduce((sum, section) => sum + section.count, 0);
  const healthy = totalFindings === 0;
  const summary = healthy
    ? "✓ 巡检通过：无异常"
    : `⚠ 巡检发现 ${totalFindings} 项：${sections
      .filter((section) => section.count > 0)
      .map((section) => `${section.name} ${section.count}`)
      .join("，")}`;

  return {
    healthy,
    totalFindings,
    sections,
    summary,
  };
}
