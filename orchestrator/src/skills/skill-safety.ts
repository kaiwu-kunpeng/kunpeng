/** 技能内容安全扫描（确定性，C8）：技能草稿进 backlog 固化前，拦下会削弱护栏或外传数据的指令。
 *  背景：Skill Misevolution（arXiv 2608.12851）——自进化产出的技能 21/21 种配置都出现过不安全产物。
 *  只做静态扫描，不跑 agent；行为回放是后续一步。禁令语境（「绝不要 --no-verify」）不算命中。 */
import { classifyInjectionRisk } from "../security/prompt-shield.js";

export interface SkillSafetyVerdict {
  /** 无硬拦项即 safe。 */
  safe: boolean;
  /** 高置信的危险指令：技能不得固化。 */
  block: string[];
  /** 讨论性内容也常命中的类别：照常固化，但把提示带出来给人看。 */
  warn: string[];
}

/** 硬拦类别：在 67 份真实第三方技能上只命中 1 份（curl|sh 式安装引导）；其余类别误报偏高，只做提示。 */
export const BLOCKING_REASONS: ReadonlySet<string> = new Set([
  "skip-git-hooks",
  "force-push",
  "edit-constitution",
  "dangerous-permission-flag",
  "injection:sensitive-file-exfiltration",
  "injection:download-and-execute",
  "injection:known-exfiltration-domain",
]);

const GUARDRAIL_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "skip-git-hooks", pattern: /--no-verify\b/i },
  { reason: "force-push", pattern: /git\s+push\b[^\n]*\s(?:--force(?:-with-lease)?|-f)\b/i },
  { reason: "recursive-force-delete", pattern: /\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)[a-z]*\b/i },
  { reason: "edit-constitution", pattern: /constitution\/core\.md|(?:修改|改写|删改)(?:不可变)?宪法/ },
  { reason: "bypass-gate", pattern: /(?:绕过|跳过|关掉|关闭|禁用|\b(?:bypass|disable|skip)\b)\s*[^\n，。,.]{0,12}?(?:人工门|门禁|合并门|验收门|范围门|闸|\bgates?\b|\bhooks?\b|审批|\bscope\b)/i },
  { reason: "weaken-tests", pattern: /(?:删除|删掉|注释掉|跳过|改弱|放宽)\s*[^\n，。,.]{0,10}?(?:测试|断言|验收)|\b(?:delete|remove|skip|comment out)\s+(?:the\s+)?(?:failing\s+)?(?:tests?|assertions?)\b/i },
  { reason: "dangerous-permission-flag", pattern: /--dangerously-(?:bypass-approvals-and-sandbox|skip-permissions)|bypassPermissions/ },
];

const NEGATION = /(?:不要|不得|不许|不准|不可|不是|不能|没有|绝不|绝对不|禁止|严禁|切勿|别|勿|\bnever\b|\bdon't\b|\bdo not\b|\bmust not\b|\bnot\b|\bavoid\b|\bno\s)/i;

const NEGATION_MAX_GAP = 20;
const CLAUSE_BOUNDARY = /[，,。.;；:：!！?？、\r\n]|就|则|然后|再|\bthen\b/gi;

/** 同一分句内紧邻命中的最后一个否定词 → 视为禁令，不算命中。 */
function negatedBefore(line: string, index: number): boolean {
  const prefix = line.slice(0, index);
  let clauseStart = 0;
  for (const match of prefix.matchAll(CLAUSE_BOUNDARY)) {
    clauseStart = match.index + match[0].length;
  }
  const clause = prefix.slice(clauseStart);
  let negationEnd: number | undefined;
  for (const match of clause.matchAll(new RegExp(NEGATION.source, `${NEGATION.flags}g`))) {
    negationEnd = match.index + match[0].length;
  }
  return negationEnd !== undefined && clause.length - negationEnd <= NEGATION_MAX_GAP;
}

export function scanSkillSafety(markdown: string): SkillSafetyVerdict {
  const reasons = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    for (const { reason, pattern } of GUARDRAIL_PATTERNS) {
      const match = pattern.exec(line);
      if (match && !negatedBefore(line, match.index)) reasons.add(reason);
    }
  }
  for (const reason of classifyInjectionRisk(markdown).reasons) reasons.add(`injection:${reason}`);
  const block = [...reasons].filter((reason) => BLOCKING_REASONS.has(reason));
  const warn = [...reasons].filter((reason) => !BLOCKING_REASONS.has(reason));
  return { safe: block.length === 0, block, warn };
}
