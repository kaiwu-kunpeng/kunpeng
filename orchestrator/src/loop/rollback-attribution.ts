// 回滚归因：把 accept 命令的真实输出确定性地归成一类 kind + 一行 summary，并把每次 accept 的完整输出落盘到
// .kunpeng/accept-logs/<flowId>/<attempt>.txt。纯函数 + 两个极薄的 fs 助手，不依赖 dev-cycle，可单测。
// 背景：历史 79.9% 的 rolled-back 只有 status，日志 reason= 是输出最后 160 字符的截断(常是 node 内部栈的路径尾巴)，
// 事后排障全靠猜；accept 真实输出只留在 /tmp/*acc*.txt 之类临时位置或根本没留。
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type RollbackKind =
  | "transform-error"   // esbuild/vite 解析失败:Transform failed / [PARSE_ERROR](语法错,测试根本没跑起来)
  | "typecheck"         // tsc: error TS1234
  | "test-failed"       // vitest 真跑了且有失败:FAIL / Tests N failed / AssertionError
  | "lint"              // eslint: ✖ N problems / `12:5  error  msg  rule-id`
  | "check-regression"  // 项目检查差分门:引入基线之外的新问题
  | "timeout"           // 命令超时被杀 / ETIMEDOUT
  | "empty-diff"        // accept 守卫判定改动为空(hollow verified 防线)
  | "no-accept-cmd"     // spec 未给验收命令(fails closed)
  | "not-red-first"     // 实现前验收已绿，先红核查回滚
  | "anchor-missing"    // grep 锚点/test -f 守卫失败:vitest 根本没跑、输出短且无 vitest 标记
  | "worktree-contention" // worktree/分支/索引锁被占，无法准备工作树
  | "audit-rejected"    // 验收测试审计或 scope 审计拒绝
  | "crashed"           // 主人进程崩溃或租约/心跳过期
  | "abandoned"         // 人工放弃该流
  | "scope-gate"        // 范围门拦截 scope 外改动
  | "eval-tamper"
  | "verify-evaluator"  // 独立评估器判 fail（或人工驳回评估器门）
  | "spec-blocker"      // 实现者求助：spec/scope 与既有锁定断言矛盾
  | "garbage-spec"      // 后端不可用，spec 阶段产出登录失败/空响应
  | "dispatch-slot-timeout" // 派流槽位超时 / 写锁冲突 / 后端不可用
  | "loop-wave-unverified"  // 运营 loop 波次未达 verified 门槛
  | "stage-timeout"     // history 相邻阶段间隔指向 600s 硬杀
  | "unknown";

export interface RollbackAttribution { kind: RollbackKind; summary: string }

export const ROLLBACK_SUMMARY_MAX = 200;

// 有意匹配并移除 ANSI 控制转义序列(vitest/eslint 彩色输出)。
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

const VITEST_MARKER = /\bRUN\s+v\d|Test Files\s+\d+|\bTests\s+\d+|^\s*[✓✔√×✗]\s|^\s*FAIL\s/m;
const WORKTREE_CONTENTION = /Preparing worktree|is already checked out|already exists and is not an empty directory|index\.lock|could not lock|Unable to create '.*\.lock'|cannot lock ref|another git process/i;

function firstLine(text: string, re: RegExp): string | undefined {
  const m = re.exec(text);
  return m ? m[0].trim() : undefined;
}

function clip(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > ROLLBACK_SUMMARY_MAX ? `${one.slice(0, ROLLBACK_SUMMARY_MAX - 1)}…` : one;
}

/** 确定性分类:同一输出永远同一结果;顺序即优先级(transform 先于 test-failed,因为 vitest 的解析失败也会报 Test Files N failed)。 */
export function classifyAcceptOutput(rawOutput: string): RollbackAttribution {
  const output = (rawOutput ?? "").replace(ANSI, "");
  const trimmed = output.trim();
  const pick = (kind: RollbackKind, summary: string | undefined, fallback: string): RollbackAttribution =>
    ({ kind, summary: clip(summary ?? fallback) });

  if (WORKTREE_CONTENTION.test(output)) {
    return pick("worktree-contention", output.split("\n").find((line) => WORKTREE_CONTENTION.test(line)), "worktree contention");
  }
  if (/Transform failed|\[PARSE_ERROR\]/.test(output)) {
    return pick("transform-error",
      firstLine(output, /^.*\[PARSE_ERROR\].*$/m) ?? firstLine(output, /^.*Transform failed.*$/m), "Transform failed");
  }
  if (/\berror TS\d{3,5}\b/.test(output)) {
    return pick("typecheck", firstLine(output, /^.*\berror TS\d{3,5}\b.*$/m), "error TS");
  }
  if (/项目检查 \[.*\] 引入基线之外的新问题/.test(output)) {
    return pick("check-regression", firstLine(output, /^.*项目检查 \[.*\] 引入基线之外的新问题.*$/m), "项目检查回归");
  }
  if (/^\s*FAIL\s|\bTests\s+\d+\s+failed\b|Test Files\s+\d+\s+failed\b|\bAssertionError\b/m.test(output)) {
    const fail = firstLine(output, /^\s*FAIL\s.*$/m);
    const assertion = firstLine(output, /^.*\bAssertionError\b.*$/m);
    const tally = firstLine(output, /^\s*Tests\s+\d+\s+failed.*$/m) ?? firstLine(output, /^\s*Test Files\s+\d+\s+failed.*$/m);
    const summary = [fail, assertion].filter(Boolean).join(" · ") || tally;
    return pick("test-failed", summary, "tests failed");
  }
  if (/✖ \d+ problems?/.test(output) || /^\s*\d+:\d+\s+error\s+.+\s+[a-z@][\w./-]*\s*$/m.test(output)) {
    return pick("lint",
      firstLine(output, /^\s*\d+:\d+\s+error\s+.+$/m) ?? firstLine(output, /^.*✖ \d+ problems?.*$/m), "eslint errors");
  }
  if (/命令超时被杀|\bETIMEDOUT\b|\btimed out\b/i.test(output)) {
    return pick("timeout", firstLine(output, /^.*(?:命令超时被杀|ETIMEDOUT|timed out).*$/im), "timeout");
  }
  if (/empty-diff|diff 为空|空 diff|改动为空|nothing to commit/i.test(output)) {
    return pick("empty-diff", firstLine(output, /^.*(?:empty-diff|diff 为空|空 diff|改动为空|nothing to commit).*$/im), "empty diff");
  }
  if (/spec 未给出验收验证命令/.test(output)) {
    return pick("no-accept-cmd", firstLine(output, /^.*spec 未给出验收验证命令.*$/m), "no acceptance command");
  }
  // 锚点缺失:vitest 根本没跑(无任何 vitest 标记),且输出为空 / 是 bash -x 的 trace / 很短。
  if (!VITEST_MARKER.test(output) && (trimmed === "" || /^\+ /m.test(output) || trimmed.length <= 600)) {
    const traced = output.split("\n").filter((l) => l.startsWith("+ "));
    const lastTrace = traced.length ? traced[traced.length - 1] : undefined;
    const firstNonEmpty = output.split("\n").map((l) => l.trim()).find((l) => l !== "");
    return pick("anchor-missing", lastTrace ?? firstNonEmpty, "accept 守卫失败且无输出");
  }
  const errLine = firstLine(output, /^.*(?:error|fail|exception).*$/im);
  const firstNonEmpty = output.split("\n").map((l) => l.trim()).find((l) => l !== "");
  return pick("unknown", errLine ?? firstNonEmpty, "(no output)");
}

/** 自由文本失败原因不使用 accept 专属的锚点缺失判据。 */
export function classifyFailureText(raw: string): RollbackAttribution {
  const text = raw.replace(ANSI, "");
  const summary = clip(text.split("\n").find((line) => line.trim() !== "") ?? "");
  const rules: [RollbackKind, RegExp][] = [
    ["worktree-contention", WORKTREE_CONTENTION],
    ["audit-rejected", /验收测试审计未通过|scope 审计未通过|invalid spec author file path/],
    ["spec-blocker", /raise-blocker|实现者求助正确/],
    ["abandoned", /^\s*\[abandoned\]/],
    ["garbage-spec", /spec 阶段产出疑似登录失败|疑似登录失败\/空响应/],
    ["dispatch-slot-timeout", /^\s*\[dispatch-slot-timeout\]|^\s*\[dispatch-lock-conflict\]|^\s*\[backend-down\]/],
    ["loop-wave-unverified", /^\s*\[loop-wave-unverified\]/],
    ["crashed", /^\s*\[retired-superseded\]|lease-expired|主人进程已崩溃|进程 \d+ 存活但 \d+ms 无心跳|^dev-cycle 异常: /],
    ["eval-tamper", /评测资产守卫|eval-tamper/],
    ["verify-evaluator", /评估器判定|评估器无法判定|verify-evaluator/],
    ["scope-gate", /范围门|scope-gate|超出 scope|不在 allow 范围/],
    ["not-red-first", /没先红/],
  ];
  for (const [kind, pattern] of rules) {
    if (pattern.test(text)) return { kind, summary };
  }
  const attribution = classifyAcceptOutput(raw);
  return attribution.kind === "anchor-missing" ? { kind: "unknown", summary } : attribution;
}

/** accept 日志目录:<kunpengDir>/accept-logs/<flowId>。kunpengDir 即 .kunpeng 目录。 */
export function acceptLogDir(kunpengDir: string, flowId: string): string {
  return join(kunpengDir, "accept-logs", flowId);
}

/** 落盘一次 accept 的完整输出。编号取目录内已有最大 N + 1(append-only:resume/重跑同一 flow 不覆盖旧 attempt)。
 *  绝不抛:跑在失败路径上,落盘失败只返回 null。 */
export async function writeAcceptLog(
  kunpengDir: string,
  flowId: string,
  entry: { cmd: string; exitCode: number; passed: boolean; output: string; extra?: string; phase?: "baseline" | "final" },
): Promise<{ path: string; attempt: number } | null> {
  try {
    const dir = acceptLogDir(kunpengDir, flowId);
    await mkdir(dir, { recursive: true });
    const used = (await readdir(dir))
      .map((f) => /^(\d+)\.txt$/.exec(f)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number);
    const attempt = (used.length ? Math.max(...used) : 0) + 1;
    const path = join(dir, `${attempt}.txt`);
    const header = [
      `# kunpeng accept log · flow=${flowId} attempt=${attempt} at=${new Date().toISOString()}`,
      `# cmd: ${entry.cmd}`,
      `# exit=${entry.exitCode} passed=${entry.passed}`,
      ...(entry.phase ? [`# phase: ${entry.phase}`] : []),
      "",
    ].join("\n");
    const tail = entry.extra ? `\n\n── 补充诊断(dev-cycle) ──\n${entry.extra}` : "";
    await writeFile(path, `${header}${entry.output}${tail}`, "utf8");
    return { path, attempt };
  } catch {
    return null;
  }
}
