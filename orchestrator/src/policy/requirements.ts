import { isHardGateLevel, type ActionLevel } from "./action-levels.js";

/** 动作分级（L0–L4）之外的第二维：各操作类别分别裁决。 */
export const OPERATION_CATEGORIES = ["shell", "file", "network", "publish"] as const;
export type OperationCategory = (typeof OPERATION_CATEGORIES)[number];
export const POLICY_DECISIONS = ["deny", "ask", "allow"] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];
export type PolicyMatrix = Readonly<Record<OperationCategory, PolicyDecision>>;
export type PolicySource = "builtin" | "defaults" | "spec" | "requirements";

/** 宪法 C5 第三类人工门：对外发布至少 ask，loop / spec 都不可放宽。 */
export const BUILTIN_REQUIREMENTS: Readonly<Partial<PolicyMatrix>> = { publish: "ask" };
/** defaults.json / spec 可覆盖的内建缺省。 */
export const BUILTIN_DEFAULTS: PolicyMatrix = { shell: "ask", file: "allow", network: "ask", publish: "ask" };

export interface PolicyClamp { category: OperationCategory; requested: PolicyDecision; enforced: PolicyDecision }
export interface ResolvedPolicy {
  matrix: PolicyMatrix;
  /** 每个类别最终取值来自哪一层。 */
  sources: Readonly<Record<OperationCategory, PolicySource>>;
  /** 请求比底线宽松时，记录被压回的覆盖。 */
  clamped: PolicyClamp[];
}

export function isOperationCategory(value: unknown): value is OperationCategory {
  return OPERATION_CATEGORIES.some((category) => category === value);
}

export function isPolicyDecision(value: unknown): value is PolicyDecision {
  return POLICY_DECISIONS.some((decision) => decision === value);
}

/** deny=2 > ask=1 > allow=0：数值越大越严。 */
export function strictness(decision: PolicyDecision): number {
  return POLICY_DECISIONS.length - 1 - POLICY_DECISIONS.indexOf(decision);
}

export function stricter(a: PolicyDecision, b: PolicyDecision): PolicyDecision {
  return strictness(a) >= strictness(b) ? a : b;
}

/** 人写配置 fail-closed：未知类别、未知取值和非对象一律抛错。 */
export function parsePolicyMatrix(value: unknown, label: string): Partial<PolicyMatrix> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: 须为对象 {类别: deny|ask|allow}`);
  const out: Partial<Record<OperationCategory, PolicyDecision>> = {};
  for (const [key, decision] of Object.entries(value as Record<string, unknown>)) {
    if (!isOperationCategory(key)) throw new Error(`${label}: 未知操作类别「${key}」，可选 ${OPERATION_CATEGORIES.join("/")}`);
    if (!isPolicyDecision(decision)) throw new Error(`${label}: 类别 ${key} 的取值「${String(decision)}」无效，可选 ${POLICY_DECISIONS.join("/")}`);
    out[key] = decision;
  }
  return out;
}

/** 内建缺省 ← defaults ← spec；最后由内建底线与 requirements 取更严者压顶。 */
export function resolveActionPolicy(input: {
  requirements?: Partial<PolicyMatrix>;
  defaults?: Partial<PolicyMatrix>;
  spec?: Partial<PolicyMatrix>;
} = {}): ResolvedPolicy {
  const matrix: Record<OperationCategory, PolicyDecision> = { ...BUILTIN_DEFAULTS };
  const sources: Record<OperationCategory, PolicySource> = { shell: "builtin", file: "builtin", network: "builtin", publish: "builtin" };
  const clamped: PolicyClamp[] = [];
  for (const category of OPERATION_CATEGORIES) {
    const fromDefaults = input.defaults?.[category];
    if (fromDefaults) { matrix[category] = fromDefaults; sources[category] = "defaults"; }
    const fromSpec = input.spec?.[category];
    if (fromSpec) { matrix[category] = fromSpec; sources[category] = "spec"; }
    const builtinFloor = BUILTIN_REQUIREMENTS[category];
    const fileFloor = input.requirements?.[category];
    const floor = builtinFloor && fileFloor ? stricter(builtinFloor, fileFloor) : (builtinFloor ?? fileFloor);
    if (floor && strictness(matrix[category]) < strictness(floor)) {
      clamped.push({ category, requested: matrix[category], enforced: floor });
      matrix[category] = floor;
      sources[category] = "requirements";
    }
  }
  return { matrix, sources, clamped };
}

/** 记住的批准只允许穿透 L0–L2；L3/L4 每次都需要本次确认。 */
export function approvalMemoryAllowed(level: ActionLevel | undefined): boolean {
  return !isHardGateLevel(level);
}

export interface OperationRequest { category: OperationCategory; level?: ActionLevel; rememberedApproval?: boolean }
export interface OperationDecision { decision: PolicyDecision; reason: string }

/** deny 不可翻转；allow 直放；ask 的批准记忆受动作等级约束。 */
export function decideOperation(policy: PolicyMatrix, request: OperationRequest): OperationDecision {
  const base = policy[request.category];
  if (base === "deny") return { decision: "deny", reason: `策略禁止 ${request.category}` };
  if (base === "allow") return { decision: "allow", reason: `策略放行 ${request.category}` };
  if (request.rememberedApproval) {
    if (approvalMemoryAllowed(request.level)) return { decision: "allow", reason: `记住的批准放行 ${request.category}（${request.level ?? "未定级"} ≤ L2）` };
    return { decision: "ask", reason: `${request.level} 不吃记住的批准，${request.category} 须本次确认` };
  }
  return { decision: "ask", reason: `策略要求确认 ${request.category}` };
}
