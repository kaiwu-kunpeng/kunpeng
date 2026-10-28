/**
 * 自我进化 · 应用编排器（阶段三 · 单流独占）。
 *
 * 把"已批准"的进化提案真正落地：复用阶段一/二的纯模块——
 *   route（路由）/ applyConventions（约定落地）/ draftPlanFromUpgrades（拟计划）/ auditGeneratedPlan（审计门）。
 * 这些依赖**全部注入**，编排器自身零硬编码业务规则，便于确定性验证（C8）且单一真相源（C6）。
 *
 * 安全不变式（本编排器必须守住）：
 *   - 只处理 status==="approved" 的提案，其余原样跳过。
 *   - upgrade 必须具备 holdout 证据并先过审计门（fail-closed）：任一不通过则**绝不**运行其计划（C4 可逆 / C6 护栏）。
 *   - conventions 永不触碰 core——core 目标被 route 兜到 unrouted，根本到不了 applyConventions（C6 护栏①）。
 *   - 编排器**绝不自合并**：成功的提案至多到 "verified"，落主干仍是人工门（C5#1），本模块无任何 merge 能力。
 */
import { hasApplicableEvidence, type ProposalEvidence, type ProposedChange } from "../loop/self-evolution.js";
import type { AgentRunner } from "../agent/runner.js";
import type { RoutedChanges } from "./route.js";
import type { PlanAuditResult } from "./audit-plan.js";
import type { Violation } from "./policy.js";
import type { Artifact } from "../artifacts/types.js";
import { conventionsChangeProblems } from "./conventions-guard.js";

/** 提案状态：只有 approved 会被本编排器处理；成功后置 verified。 */
const APPROVED = "approved" as const;
const VERIFIED = "verified" as const;

/** 一条待应用的进化提案。status 由人工门 #2 置为 approved 后方可入此编排器。 */
export interface EvolutionProposal {
  id: string;
  status: string;
  changes: ProposedChange[];
  evidence?: ProposalEvidence;
}

/** 从 proposal 产物映射出可应用提案。**evidence 必须从 meta.proposal 透传**——
 *  否则到达证据闸时恒为 undefined → 升级被「无证据」无条件拦下（生产 cli 旁路 bug）。
 *  生产链路（cli apply）唯一映射入口，集中于此并单测，避免再次漏读。 */
export function evolutionProposalFromArtifact(p: Pick<Artifact, "id" | "meta" | "status">): EvolutionProposal {
  const meta = (p.meta as { proposal?: { changes?: ProposedChange[]; evidence?: ProposalEvidence } } | undefined)?.proposal;
  return { id: p.id, status: p.status, changes: meta?.changes ?? [], evidence: meta?.evidence };
}

/** 执行一份已审计放行的计划 Markdown（如在隔离 worktree 内跑 `kunpeng plan`）。 */
export type PlanRunner = (planMd: string) => Promise<void>;

/**
 * 注入式依赖：阶段一/二纯模块 + 两个运行器 + 约定文件路径。
 * 全部注入 → 编排器可被确定性测试夹具完全替换，无隐藏 I/O（C8）。
 */
export interface ApplyDeps {
  /** 约定 md 落地路径（applyConventions 的写入目标；绝非 core）。 */
  conventionsPath: string;
  /** 阶段一：提案按目标分派三去向（禁区兜底已内建）。 */
  route: (changes: ProposedChange[]) => RoutedChanges;
  /** 阶段二：把 conventions 条目幂等追加进约定 md。 */
  applyConventions: (
    mdPath: string,
    changes: ProposedChange[],
  ) => Promise<{ appended: string[]; skipped: string[] }>;
  /** 阶段二：把 upgrades 交给后端 LLM 翻成一份 `方案.md`。 */
  draftPlanFromUpgrades: (
    upgrades: ProposedChange[],
    runner: AgentRunner,
  ) => Promise<string>;
  /** 阶段二：对 LLM 生成的计划做 grep 级确定性审计（fail-closed）。 */
  auditGeneratedPlan: (planMd: string) => PlanAuditResult;
  /** 起草计划用的 LLM 运行器（喂给 draftPlanFromUpgrades）。 */
  draftRunner: AgentRunner;
  /** 执行已审计放行计划的运行器——只有 safe 才会被调用。 */
  planRunner: PlanRunner;
  /** 技能草稿验真后交接 backlog，绝不直接写仓库 skills/。 */
  applySkills?: (changes: ProposedChange[]) => Promise<{
    enqueued: string[];
    skipped: string[];
    rejected: Array<{ slug: string; reason: string }>;
  }>;
}

/** 单条提案的处理结局。 */
export interface ProposalOutcome {
  id: string;
  /** 处理后的最终状态：成功落地 → verified；被审计拦下或未动 → 维持原状态。 */
  status: string;
  /** 该提案追加的约定条目数。 */
  conventionsApplied: number;
  /** 该提案交接 backlog 的技能条目数。 */
  skillsEnqueued: number;
  /** 该提案是否运行过计划（safe upgrade 才为 true）。 */
  planRun: boolean;
  /** 该提案被审计门拦下的违规（非空 = 被 fail-closed 拦住，未运行计划）。 */
  violations: Violation[];
  /** 落入禁区/未知的变更（如 core 目标）——不静默丢弃。 */
  unrouted: ProposedChange[];
}

/** 整批应用报告（确定性可断言）。 */
export interface ApplyReport {
  /** 全批追加的约定条目总数。 */
  conventionsApplied: number;
  /** 全批交接 backlog 的技能条目总数。 */
  skillsEnqueued: number;
  /** 全批被落地质量门拒绝的约定条目总数。 */
  conventionsRejected: number;
  /** 全批运行的计划次数（= planRunner 实际被调用次数）。 */
  plansRun: number;
  /** 每条输入提案的结局（顺序与输入一致）。 */
  outcomes: ProposalOutcome[];
}

/**
 * 应用一批进化提案。
 *
 * 对每条提案：
 *   - status !== approved → 原样跳过（不路由、不写文件、不跑计划）。
 *   - approved → route 分派；conventions 经 applyConventions 落地；
 *     upgrades 先检查 evidence，再经 draftPlanFromUpgrades 拟计划 → auditGeneratedPlan 审计：
 *       evidence 缺失/退化 → 记录违规、**绝不**运行计划（fail-closed）。
 *       safe             → planRunner 执行计划（恰一次），计入 planRun；
 *       unsafe           → 记录违规、**绝不**运行计划（fail-closed）。
 *   - 仅当确有落地动作且无任何环节被审计拦下时，才把状态推进到 verified；
 *     否则维持原状态（approved）等下一轮/人核。落主干仍是人工门，本模块从不自合并。
 */
export async function applyApprovedProposals(
  proposals: EvolutionProposal[],
  deps: ApplyDeps,
): Promise<ApplyReport> {
  const outcomes: ProposalOutcome[] = [];
  let conventionsApplied = 0;
  let conventionsRejected = 0;
  let skillsEnqueued = 0;
  let plansRun = 0;

  for (const proposal of proposals) {
    // 只处理 approved；其余原样跳过（安全不变式：只动被批准的）。
    if (proposal.status !== APPROVED) {
      outcomes.push({
        id: proposal.id,
        status: proposal.status,
        conventionsApplied: 0,
        skillsEnqueued: 0,
        planRun: false,
        violations: [],
        unrouted: [],
      });
      continue;
    }

    const routed = deps.route(proposal.changes);
    let appliedHere = 0;
    let skillsEnqueuedHere = 0;
    let unrouted = routed.unrouted;
    let planRun = false;
    let violations: Violation[] = [];
    let blocked = false;
    let acted = false;

    // 约定：幂等追加。core 目标已被 route 兜到 unrouted，到不了这里。
    if (routed.conventions.length) {
      const safeConventions = routed.conventions.filter((change) => {
        const problems = conventionsChangeProblems(change.text);
        if (problems.length) conventionsRejected += 1;
        return problems.length === 0;
      });
      const { appended } = await deps.applyConventions(
        deps.conventionsPath,
        safeConventions,
      );
      appliedHere += appended.length;
      if (appended.length) acted = true;
    }

    // 升级：先过证据闸，再拟计划并过审计门（并列 fail-closed）；全部通过才运行。
    if (routed.upgrades.length) {
      if (!hasApplicableEvidence(proposal.evidence)) {
        violations = [{
          id: "no-evidence",
          reason: "upgrade 缺 holdout 评测证据，fail-closed",
          match: "evidence",
        }];
        blocked = true;
      } else {
        const planMd = await deps.draftPlanFromUpgrades(
          routed.upgrades,
          deps.draftRunner,
        );
        const audit = deps.auditGeneratedPlan(planMd);
        if (audit.safe) {
          await deps.planRunner(planMd); // 恰一次。
          planRun = true;
          plansRun += 1;
          acted = true;
        } else {
          violations = audit.violations; // 被拦下：绝不运行计划。
          blocked = true;
        }
      }
    }

    const skills = routed.skills ?? [];
    if (skills.length > 0) {
      if (!deps.applySkills) {
        unrouted = [...routed.unrouted, ...skills];
      } else {
        const r = await deps.applySkills(skills);
        if (r.enqueued.length > 0) {
          acted = true;
          skillsEnqueuedHere = r.enqueued.length;
        }
      }
    }

    skillsEnqueued += skillsEnqueuedHere;
    conventionsApplied += appliedHere;
    // 确有落地动作且无任何环节被拦下 → 推进到 verified；否则维持原状态。
    const status = acted && !blocked ? VERIFIED : proposal.status;

    outcomes.push({
      id: proposal.id,
      status,
      conventionsApplied: appliedHere,
      skillsEnqueued: skillsEnqueuedHere,
      planRun,
      violations,
      unrouted,
    });
  }

  return { conventionsApplied, conventionsRejected, skillsEnqueued, plansRun, outcomes };
}
