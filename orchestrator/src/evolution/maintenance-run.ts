import { execFileSync } from "node:child_process";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { randomBytes } from "node:crypto";
import { basename, join } from "node:path";
import { ArtifactStore } from "../artifacts/store.js";
import { CaptureStore, newCapture, resolveCapturesDir } from "../knowledge/capture-store.js";
import { FlowTracker } from "../runtime/flowstate.js";
import { flowsToCostReport } from "../runtime/flow-cost.js";
import { logMaintenance } from "../metrics/maintenance-ledger.js";
import type { Researcher } from "../research/types.js";
import type { ModuleStatus } from "../status/types.js";
import type { FailureRecord } from "./failure-digest.js";
import { researchableFailureRecords } from "./experience-failures.js";
import { fitnessSnapshot as computeFitness, compareFitness, type FitnessSnapshot } from "./fitness.js";
import { fitnessVerdict, summarizeFitness } from "./fitness-gate.js";
import { FitnessBaselineStore, ZERO_FITNESS } from "./fitness-baseline.js";
import { compareKpi, type KpiProvider, type ProductKpiSnapshot } from "./product-kpi.js";
import { resolveKpiProvider } from "./kpi-registry.js";
import { ProductKpiBaselineStore } from "./kpi-baseline.js";
import { combinedVerdict } from "./combined-verdict.js";
import { runMaintenanceScan, type MaintenanceScanResult } from "./maintenance-scan.js";
import { findingKey, type SelfEvoFinding } from "./self-evo-finding.js";

export type AuditRunner = (cwd: string) => string;

function defaultAuditRunner(cwd: string): string {
  return execFileSync("npm", ["audit", "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  });
}

function stdoutFrom(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("stdout" in error)) return null;
  const stdout = error.stdout;
  if (typeof stdout === "string") return stdout;
  if (Buffer.isBuffer(stdout)) return stdout.toString("utf8");
  return null;
}

export async function liveAuditJson(orchestratorDir: string, run: AuditRunner = defaultAuditRunner): Promise<string> {
  try {
    return run(orchestratorDir);
  } catch (error) {
    return stdoutFrom(error) ?? "{}";
  }
}

export interface MaintenanceLiveDeps {
  auditJson?: () => Promise<string>;
  moduleStatuses?: () => Promise<ModuleStatus[]>;
  now?: () => number;
  id?: () => string;
  topN?: number;
  researcher?: Researcher;
  failureRecords?: () => Promise<FailureRecord[]>;
  maxResearchDirections?: number;
  fitnessSnapshot?: () => Promise<FitnessSnapshot | undefined>;
  loadBaseline?: () => Promise<FitnessSnapshot | null>;
  saveBaseline?: (snapshot: FitnessSnapshot) => Promise<void>;
  projectId?: string;
  kpiProvider?: KpiProvider;  // B 维产品 KPI provider（显式注入优先；默认按 projectId 解析）
  loadKpiBaseline?: () => Promise<ProductKpiSnapshot | null>;
  saveKpiBaseline?: (snapshot: ProductKpiSnapshot) => Promise<void>;
  existingKeys?: () => Promise<Set<string>>;
}

function defaultId(): string {
  return `mr-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function recordMaintenanceRun(
  repoRoot: string,
  startedAtMs: number,
  opts?: { what?: string; now?: () => number },
): void {
  try {
    const elapsed = (opts?.now ?? Date.now)() - startedAtMs;
    const minutes = Math.round((elapsed <= 0 ? 0 : elapsed / 60000) * 10) / 10;
    logMaintenance(
      resolveProjectStateDir(repoRoot),
      opts?.what ?? "maintain 自动巡检",
      minutes,
    );
  } catch {
    // Maintenance tax recording must never break the maintenance run.
  }
}

export async function runMaintenanceLive(
  repoRoot: string,
  deps: MaintenanceLiveDeps = {},
): Promise<MaintenanceScanResult> {
  const startedAt = (deps.now ?? Date.now)();
  const store = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));
  const captures = new CaptureStore(resolveCapturesDir(repoRoot));
  const now = deps.now ?? (() => Date.now());
  const id = deps.id ?? defaultId;
  const result = await runMaintenanceScan({
    store,
    captures,
    auditJson: deps.auditJson ?? (() => liveAuditJson(join(repoRoot, "orchestrator"))),
    moduleStatuses: deps.moduleStatuses ?? (async () => []),
    now,
    id,
    topN: deps.topN,
    researcher: deps.researcher,
    failureRecords: deps.failureRecords ?? (async () => researchableFailureRecords(await store.list("experience"))),
    maxResearchDirections: deps.maxResearchDirections,
    existingKeys: deps.existingKeys ?? (async () => {
      const keys = new Set<string>();
      for (const artifact of await store.list("proposal")) {
        const proposal = (artifact.meta?.proposal ?? {}) as { channel?: string; title?: string };
        if (proposal.channel && proposal.title) {
          keys.add(findingKey({ channel: proposal.channel, title: proposal.title } as SelfEvoFinding));
        }
      }
      return keys;
    }),
    // 默认接真实 flow：FlowTracker.list() 返回的 FlowState[] 与 fitnessSnapshot 期望兼容（state.ts 同样这么喂 aggregateSavings）。
    // 接成本侧：从 flow 的按阶段 token 推真实成本报告喂进快照（token 精确、USD 按定价），不再 token=0。
    fitnessSnapshot: deps.fitnessSnapshot ?? (async () => {
      const flows = await new FlowTracker(resolveProjectStateDir(repoRoot)).list();
      return computeFitness(flows, [flowsToCostReport(flows)]);
    }),
  });
  // 真适应度趋势（E0③）：当前 vs 上轮 baseline 算真 Δ，落 KB + 更新 baseline。全在 live 层，不动 scan 计数器。
  if (result.fitness) {
    const baselineStore = new FitnessBaselineStore(join(resolveProjectStateDir(repoRoot), "fitness-baseline.json"));
    const loadBaseline = deps.loadBaseline ?? (() => baselineStore.load());
    const saveBaseline = deps.saveBaseline ?? ((s: FitnessSnapshot) => baselineStore.save(s));

    const baseline = (await loadBaseline()) ?? ZERO_FITNESS;
    const delta = compareFitness(baseline, result.fitness);
    result.fitnessDelta = delta;

    const verdict = fitnessVerdict(delta);
    const summary = `${summarizeFitness(result.fitness)}｜${verdict.reason}`;
    await captures.appendCapture(newCapture(
      { source: "text", kind: "self-evo-fitness", raw: summary, summary, tags: ["fitness", "north-star", verdict.pass ? "improving" : "flat-or-regress"] },
      { now, id },
    ));
    await saveBaseline(result.fitness);
  }
  // B 维：产品 KPI 真趋势 Δ（接产品）。默认按 projectId 解析 provider；与 A 并行，出双维合并裁决落 KB。
  const kpiProvider = deps.kpiProvider ?? resolveKpiProvider(deps.projectId ?? basename(repoRoot));
  let bSnap: ProductKpiSnapshot | undefined;
  try { bSnap = await kpiProvider(repoRoot); } catch { bSnap = undefined; }
  if (bSnap) {
    const kpiBaselineStore = new ProductKpiBaselineStore(join(resolveProjectStateDir(repoRoot), "product-kpi-baseline.json"));
    const loadKpiBaseline = deps.loadKpiBaseline ?? (() => kpiBaselineStore.load());
    const saveKpiBaseline = deps.saveKpiBaseline ?? ((s: ProductKpiSnapshot) => kpiBaselineStore.save(s));

    const bBaseline = (await loadKpiBaseline()) ?? bSnap;
    const bDelta = compareKpi(bBaseline, bSnap);
    result.kpiDelta = bDelta;

    // 双维合并裁决：A 不退化 ∧ B 改进 = 真进步。需 A-Δ 在场（live 层 result.fitness 在场即有）。
    if (result.fitnessDelta) {
      const verdict = combinedVerdict(result.fitnessDelta, bDelta);
      const summary = `双维裁决｜${verdict.reason}`;
      await captures.appendCapture(newCapture(
        { source: "text", kind: "self-evo-combined-verdict", raw: summary, summary, tags: ["fitness", "product-kpi", verdict.pass ? "progress" : "not-met"] },
        { now, id },
      ));
    }
    await saveKpiBaseline(bSnap);
  }
  recordMaintenanceRun(repoRoot, startedAt, { now: deps.now });
  return result;
}
