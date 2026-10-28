import type { NewCaptureInput } from "../knowledge/capture-store.js";

export type SelfEvoChannel = "ears" | "official" | "module" | "security";
export type EvidenceState = "tested" | "untested" | "downgraded";

export interface SelfEvoFinding {
  channel: SelfEvoChannel;
  title: string;
  detail: string;
  sources: string[];
  evidenceState: EvidenceState;
  score: number;
}

export function findingToCapture(f: SelfEvoFinding): NewCaptureInput {
  return {
    source: "text",
    kind: "self-evolution",
    category: "self-evolution",
    raw: f.detail,
    title: f.title,
    tags: [f.channel, f.evidenceState],
  };
}

export function findingKey(f: SelfEvoFinding): string {
  const normalizedTitle = f.title.trim().replace(/\s+/g, " ").toLowerCase();
  return `${f.channel}:${normalizedTitle}`;
}

export function dedupeFindings(findings: SelfEvoFinding[], seen = new Set<string>()): SelfEvoFinding[] {
  const out: SelfEvoFinding[] = [];

  for (const finding of findings) {
    const key = findingKey(finding);
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(finding);
  }

  return out;
}

export function selectTopPerChannel(findings: SelfEvoFinding[], n: number): SelfEvoFinding[] {
  if (n <= 0) return [];

  const grouped = new Map<SelfEvoChannel, Array<{ finding: SelfEvoFinding; index: number }>>();

  findings.forEach((finding, index) => {
    const group = grouped.get(finding.channel) ?? [];
    group.push({ finding, index });
    grouped.set(finding.channel, group);
  });

  return Array.from(grouped.values()).flatMap((group) =>
    [...group]
      .sort((a, b) => b.finding.score - a.finding.score || a.index - b.index)
      .slice(0, n)
      .map((entry) => entry.finding),
  );
}
