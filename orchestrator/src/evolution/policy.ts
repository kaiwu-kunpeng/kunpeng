/**
 * 自我进化 · 确定性安全闸（宪法 C8：确定性优先；C6：进化护栏）。
 *
 * 纯函数、零 I/O：在自进化提案被"应用"或其拟执行命令被运行之前，
 * 用 grep 级别的确定性扫描判定越权/不可逆/供应链风险，命中即拒，不调用 LLM。
 *
 * 两条独立闸：
 *   1) findViolations(command)  —— 扫"拟执行命令"里的危险动作。
 *   2) targetForbidden(target)  —— 扫"拟改目标路径"是否落在禁区（core 兜底）。
 */

/** 一条危险命令模式。data-driven，便于审计与扩展。 */
export interface DangerPattern {
  /** 稳定标识，供上层去重 / 引用。 */
  id: string;
  /** 命中即危险的模式（务必非 global，避免 lastIndex 状态污染）。 */
  re: RegExp;
  /** 人类可读理由（附宪法条款）。 */
  reason: string;
  /** 豁免：若同一命令也命中此模式，则不算违规——用于消除已知误判。 */
  unless?: RegExp;
}

/** 一条命中的违规记录。 */
export interface Violation {
  id: string;
  reason: string;
  /** 命中的原文片段，便于人核对。 */
  match: string;
}

/**
 * 危险命令模式表。
 *
 * 关键不误判：`npx --no-install …` 只用本地已装包、不联网拉取，
 * 不是供应链安装——故 npx 模式带 `unless: /--no-install/`。
 * （本仓库的验证命令本身即 `npx --no-install vitest …`，绝不能被自己的闸拦下。）
 */
export const DANGER_PATTERNS: readonly DangerPattern[] = [
  {
    id: "rm-rf",
    // rm 且同时带「递归」与「强制」标志（任意顺序，含合并写法 -rf/-fr 与长选项）。
    re: /\brm\b(?=[^\n]*(-\w*r\w*|--recursive))(?=[^\n]*(-\w*f\w*|--force))/i,
    reason: "递归强删 (rm -rf)，不可逆 (C4)",
  },
  {
    id: "pipe-to-shell",
    re: /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i,
    reason: "下载内容直接管道进 shell 执行（远程代码执行）",
  },
  {
    id: "git-force-push",
    re: /\bgit\s+push\b[^\n]*(\s--force\b|\s-f\b|\s--force-with-lease\b)/i,
    reason: "强制推送会覆盖远端历史，不可逆 (C4)",
  },
  {
    id: "sudo",
    re: /\bsudo\b/i,
    reason: "提权执行 (sudo)，越出最小权限 (C7)",
  },
  {
    id: "chmod-world-writable",
    re: /\bchmod\b[^\n]*\b0?777\b/i,
    reason: "chmod 777 全局可写，权限过度放开",
  },
  {
    id: "pkg-install",
    re: /\b(npm|pnpm)\s+(i|install|add)\b|\byarn\s+(add|install)\b/i,
    reason: "联网安装依赖（供应链风险），须经人工门 (C5)",
  },
  {
    id: "npx-fetch",
    re: /\bnpx\b/i,
    reason: "npx 可能联网拉取并执行包（供应链风险）",
    unless: /--no-install\b/, // --no-install 只跑本地已装包，不联网——不算供应链安装。
  },
];

/**
 * 禁区路径：自我进化不得改写/删除（C6 护栏①、C5#2 人工门）。
 * 不可变核心与角色卡的固化必须由人类手动执行。
 */
export const FORBIDDEN_PATHS: readonly string[] = [
  "constitution/core.md", // 不可变核心
  "constitution/roles/", // 角色卡
];

/**
 * core 兜底正则：generalize 自 self-evolution 的 IMMUTABLE=/core/i。
 * 即便禁区路径表漏配，任何指向 core 的目标也被这条兜底拦下。
 * \bcore\b 命中 "constitution/core.md" / "core"，但不误伤 "conventions" / "scoreboard"。
 */
export const FORBIDDEN_TARGET_RE = /\bcore\b|core\.md/i;

/**
 * 扫描一条命令，返回全部命中的危险模式（空数组 = 安全）。
 * 纯函数：同输入同输出，无副作用、无 I/O。
 */
export function findViolations(command: string): Violation[] {
  const out: Violation[] = [];
  for (const p of DANGER_PATTERNS) {
    const m = p.re.exec(command);
    if (!m) continue;
    if (p.unless && p.unless.test(command)) continue; // 已知豁免，消除误判。
    out.push({ id: p.id, reason: p.reason, match: m[0] });
  }
  return out;
}

/**
 * 判定一个"拟改目标"是否落在禁区。
 * 先查显式禁区路径表，再以 core 兜底正则兜底。
 */
export function targetForbidden(target: string): boolean {
  if (typeof target !== "string") return false;
  if (FORBIDDEN_PATHS.some((p) => target.includes(p))) return true;
  return FORBIDDEN_TARGET_RE.test(target);
}

/**
 * 禁区路径引用表：自我进化生成的「方案 md」正文里**提及要改写**这些路径即拦
 * （NVIDIA 沙箱指南：写 agent 配置/hooks 一律阻断，无视批准）。
 * 取**具体路径串**（非裸词 core），避免误伤散文里的 "core logic" 等正常用语。
 */
const FORBIDDEN_PLAN_REFS: readonly string[] = [
  ...FORBIDDEN_PATHS, // constitution/core.md · constitution/roles/
  ".git/hooks",
  "CLAUDE.md",
  "AGENTS.md",
  "settings.json",
  ".claude/",
  "mcp.json",
];

/**
 * 扫描一份「方案 md」正文里是否提及改写禁区路径（与 findViolations 互补：
 * 那条扫危险**命令**，这条扫禁区**路径引用**）。fail-closed：命中即违规、降级人工。
 * 纯函数、零 I/O。
 */
export function findForbiddenPathRefs(text: string): Violation[] {
  const out: Violation[] = [];
  for (const ref of FORBIDDEN_PLAN_REFS) {
    if (text.includes(ref)) {
      out.push({ id: `forbidden-path:${ref}`, reason: `方案提及改写禁区路径 ${ref}（自进化不得触碰 core/角色卡/agent 配置/hooks，C6/C5）`, match: ref });
    }
  }
  return out;
}
