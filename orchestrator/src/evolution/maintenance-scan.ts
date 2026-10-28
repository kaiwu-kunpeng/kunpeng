import type { ArtifactStore } from "../artifacts/store.js";
import { CaptureStore, newCapture } from "../knowledge/capture-store.js";
import type { Researcher } from "../research/types.js";
import type { ModuleStatus } from "../status/types.js";
import type { FailureRecord } from "./failure-digest.js";
import { summarizeFailures } from "./failure-digest.js";
import { earsFindings } from "./ears-research.js";
import { parseAuditFindings } from "./security-audit.js";
import { scanModuleHealth } from "./module-health.js";
import { dedupeFindings, findingKey, findingToCapture, selectTopPerChannel } from "./self-evo-finding.js";

export interface MaintenanceScanDeps {
  store: ArtifactStore;
  captures: CaptureStore;
  auditJson: () => Promise<string>;
  moduleStatuses: () => Promise<ModuleStatus[]>;
  now: () => number;
  id: () => string;
  topN?: number;
  researcher?: Researcher;
  failureRecords?: () => Promise<FailureRecord[]>;
  maxResearchDirections?: number;
  fitnessSnapshot?: () => Promise<import("./fitness.js").FitnessSnapshot | undefined>;
  existingKeys?: () => Promise<Set<string>>;
}

export interface MaintenanceScanResult {
  findingsTotal: number;
  selected: number;
  proposalsWritten: number;
  capturesWritten: number;
  fitness?: import("./fitness.js").FitnessSnapshot;  // 真适应度系统快照（仅 surface，不写 capture，保 capturesWritten 不变式）
  fitnessDelta?: import("./fitness.js").FitnessDelta;  // 当前 vs 上轮 baseline 的真趋势 Δ（E0③，由 live 层填）
  kpiDelta?: import("./product-kpi.js").ProductKpiDelta;  // B 维产品 KPI 真趋势 Δ（接产品，由 live 层填）
}

function proposalBody(finding: ReturnType<typeof dedupeFindings>[number]): string {
  return [
    `# ${finding.title}`,
    "",
    finding.detail,
    "",
    `- channel: ${finding.channel}`,
    `- score: ${finding.score}`,
    `- evidenceState: ${finding.evidenceState}`,
  ].join("\n");
}

export async function runMaintenanceScan(deps: MaintenanceScanDeps): Promise<MaintenanceScanResult> {
  const findings = [
    ...parseAuditFindings(await deps.auditJson()),
    ...scanModuleHealth(await deps.moduleStatuses()),
  ];
  if (deps.researcher && deps.failureRecords) {
    findings.push(...await earsFindings(
      summarizeFailures(await deps.failureRecords()),
      deps.researcher,
      { maxDirections: deps.maxResearchDirections },
    ));
  }
  const selectedFindings = selectTopPerChannel(dedupeFindings(findings), deps.topN ?? 3);
  const existing = deps.existingKeys ? await deps.existingKeys() : new Set<string>();
  const freshFindings = selectedFindings.filter((finding) => !existing.has(findingKey(finding)));

  let proposalsWritten = 0;
  let capturesWritten = 0;

  for (const finding of freshFindings) {
    const capture = newCapture(findingToCapture(finding), { now: deps.now, id: deps.id });
    if (await deps.captures.appendCapture(capture)) capturesWritten += 1;

    await deps.store.write({
      kind: "proposal",
      id: deps.id(),
      status: "draft",
      body: proposalBody(finding),
      meta: {
        proposal: {
          channel: finding.channel,
          title: finding.title,
          score: finding.score,
          evidenceState: finding.evidenceState,
          sources: finding.sources,
        },
      },
    });
    proposalsWritten += 1;
  }

  return {
    findingsTotal: findings.length,
    selected: freshFindings.length,
    proposalsWritten,
    capturesWritten,
    fitness: deps.fitnessSnapshot ? await deps.fitnessSnapshot() : undefined,
  };
}
