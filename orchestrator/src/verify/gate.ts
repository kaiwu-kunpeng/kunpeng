import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { buildFlowEnv } from "../project/profile-env-builder.js";

export interface VerifyInput { cwd: string; cmd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; strict?: boolean; }
export interface VerifyResult { passed: boolean; output: string; exitCode: number; }

/** 验收命令可能来自远端请求，执行环境复用 agent 的白名单（PATH/HOME/KUNPENG_* 等），剥掉宿主凭据。 */
function acceptEnv(input: VerifyInput): Record<string, string> {
  return buildFlowEnv({ baseEnv: input.env ?? process.env });
}

export function runVerification(input: VerifyInput): Promise<VerifyResult> {
  return new Promise((resolve) => {
    // 用 bash 跑：子 agent 自然吐 bash 命令（如进程替换 <(...)），默认 /bin/sh 会语法错。
    exec(input.strict === true ? "set -e\n" + input.cmd : input.cmd, { cwd: input.cwd, timeout: input.timeoutMs ?? 120_000, shell: "/bin/bash", env: acceptEnv(input) },
      (err, stdout, stderr) => {
        const output = `${stdout}${stderr}`;
        const exitCode = err && typeof (err as { code?: number }).code === "number" ? (err as { code?: number }).code! : err ? 1 : 0;
        resolve({ passed: exitCode === 0, output, exitCode });
      });
  });
}

// 差分验证：真项目基线本来就可能红（如缺 @types/jest）。门只看「我的改动有没有引入基线之外的新错」，
// 而不是「整个项目是否全绿」——否则在不完美的真项目上每条流都会被回滚。
const ERR_LIKE = /error|Error|✖|✗|×|FAIL|fail(?:ed)?|warning|Warning|TS\d{3,}|AssertionError/i;

function normalizeVerifyLine(line: string): string {
  return line
    // 先剥 ANSI 色码:vitest 的 ✓ 行首带 \x1b[32m(慢测试变 \x1b[33m,颜色随耗时逐跑漂移),
    // 不剥则 isPassLine 的 /^[✓✔√]/ 匹配不到、且同一行两跑颜色不同被逐行差分当「新失败」
    // (测试名含 fail/error 字样时又恰好过 ERR_LIKE,三者叠加击穿差分门——2026-07-05 实锤)。
    // 有意匹配并移除验证输出中的 ANSI 控制转义序列。
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, "")
    .trim()
    .replace(/(\/[^ \t'"]*?\.kunpeng\/wt\/)[^/\s'"]+/g, "$1<worktree>")
    .replace(/\/(?:private\/)?var\/folders\/[^ \t'"]+?\/T\/([A-Za-z0-9_-]+?)-[A-Za-z0-9]{4,}(?=[/ \t'"]|$)/g, "<tmp>/$1-<id>")
    .replace(/\/tmp\/([A-Za-z0-9_-]+?)-[A-Za-z0-9]{4,}(?=[/ \t'"]|$)/g, "<tmp>/$1-<id>")
    // 归一鲲鹏运行时实体 id(plan-/flow-/msg-/exp- 后带时间戳/哈希)——集成测试会跑真 plan，
    // 这些 id 每跑都不同，否则逐行差分把它们当「新失败」(并发假回归根因之一)。
    .replace(/\b(plan|flow|msg|exp)-[a-z0-9]{6,}(?:-[a-z0-9]{4,})?/gi, "$1-<id>")
    .replace(/\s+\d+(?:\.\d+)?\s*ms\b/gi, "")
    .replace(/\s*(?:\(|（)?\d+(?:\.\d+)?\s*(?:ms|s)(?:\)|）)?\s*$/i, "")
    .trim();
}

function isSummaryNoiseLine(line: string): boolean {
  return /^(?:Test Files|Tests|Test Suites|Snapshots)\s+/i.test(line.trim());
}

// 应用运行时日志行(鲲鹏 logger 前缀 [warn]/[workspace]/[接线员]/[结果] 等)：集成测试跑真 plan/loop
// 时会把这些日志吐进 stdout 被捕获，它们不是 tsc/vitest 的检查失败、且常带时间戳 id 每跑不同。
// 差分门只该比对真正的检查失败(error TS… / ✗ / FAIL / AssertionError)，故整体排除这些 app 日志行
// (并发假回归根因之二)。
function isLoggerLine(line: string): boolean {
  return /^\[[^\]]+\]/.test(line.trim());
}

function isConsoleHeaderLine(line: string): boolean {
  return /^(?:stderr|stdout)\s*\|\s/.test(line.trim());
}

function isPassLine(line: string): boolean {
  const trimmed = line.trim();
  return /^[✓✔√]/u.test(trimmed) || /^(?:ok|pass|passed|RUN)\b/i.test(trimmed);
}

/** 输出去掉所有空白后为空 = 无任何有效输出（accept 守卫静默挂掉 / 超时被杀的特征）。 */
export function isBlankOutput(output: string): boolean {
  return output.replace(/\s+/g, "").length === 0;
}

/** 从命令里解析出 stdout/stderr 被重定向到的文件路径（`> f`、`>> f`、`&> f`、`&>> f`；
 *  `> f 2>&1` 的目标就是 `f`）。路径可能带引号，去引号；按出现顺序去重。
 *  纯静态字符串解析，不执行、不抛异常。 */
function parseRedirectTargets(cmd: string): string[] {
  const targets: string[] = [];
  // 分隔符/行首之后紧跟重定向算子(&>>|&>|>>|>)，再取其后的目标 token(可带引号)。
  // fd 前缀的 2>&1 因 `>` 前是数字而非分隔符,不会被误捕为文件。
  const re = /(?:^|[\s;&|(])(?:&>>|&>|>>|>)\s*("[^"]*"|'[^']*'|[^\s;&|<>()]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    let p = m[1];
    if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
      p = p.slice(1, -1);
    }
    if (p && !targets.includes(p)) targets.push(p);
  }
  return targets;
}

/** 读文件尾部若干行；文件不存在/读不了/为空一律返回 null（本函数跑在失败路径上，绝不抛）。 */
function readRedirectTail(filePath: string, cwd: string, maxLines: number): string[] | null {
  try {
    const abs = isAbsolute(filePath) ? filePath : join(cwd, filePath);
    if (!existsSync(abs)) return null;
    const content = readFileSync(abs, "utf8");
    if (content.replace(/\s+/g, "").length === 0) return null; // 空/纯空白 → 跳过,不产生空洞标题块
    const lines = content.split("\n");
    while (lines.length && lines[lines.length - 1] === "") lines.pop(); // 去尾随空行(结尾换行)
    return lines.slice(-maxLines);
  } catch {
    return null;
  }
}

/** 验证失败但零输出时，用 bash -x 重跑把「执行到哪条子命令挂的」trace 暴露出来，并把 accept 重定向到
 *  文件（`/tmp/*.txt` 等）的真实输出读回证据——让回滚可诊断、修复 agent 有真实信号（治根因：
 *  test -f/grep 守卫失败无输出 + 真实红点被埋在重定向文件里 → 空/误导 reason → 不可诊断不可自修）。
 *  仅在 isBlankOutput 命中时调用：此时失败必在 tsc/vitest 之前的轻守卫，bash -x 重跑很便宜。 */
export function diagnoseBlankFailure(input: VerifyInput): Promise<string> {
  return new Promise((resolve) => {
    exec(`set -x; ${input.cmd}`, { cwd: input.cwd, timeout: input.timeoutMs ?? 120_000, shell: "/bin/bash", env: acceptEnv(input) },
      (err, stdout, stderr) => {
        const timedOut = !!(err && (err as { killed?: boolean }).killed);
        const traced = `${stderr}${stdout}`;
        const cmdLines = traced.split("\n").filter((l) => l.startsWith("+"));
        const tail = cmdLines.slice(-4);
        const head = timedOut
          ? "验证失败：命令超时被杀(>timeout)、无输出。以下为执行到的最后几条子命令(trace)："
          : "验证失败，命令自身输出为空。以下是执行到的最后几条子命令(trace)，其后是 accept 重定向到文件的真实输出：";
        const parts = [head, ...(tail.length ? tail : ["(无 trace)"])];
        // 重跑已重新写过这些重定向文件；把每个存在且非空的文件尾部读回证据（每个文件只取尾部,天然构成上限）。
        for (const target of parseRedirectTargets(input.cmd)) {
          const fileLines = readRedirectTail(target, input.cwd, 30);
          if (!fileLines || fileLines.length === 0) continue;
          parts.push(`── 重定向输出 ${target}(尾部 ${fileLines.length} 行) ──`, ...fileLines);
        }
        resolve(parts.join("\n"));
      });
  });
}

export function newFailures(baseline: string, after: string): string[] {
  const norm = (s: string) =>
    new Set(
      s
        .split("\n")
        .map(normalizeVerifyLine)
        .filter((line) => line && !isSummaryNoiseLine(line) && !isPassLine(line) && !isLoggerLine(line) && !isConsoleHeaderLine(line) && ERR_LIKE.test(line)),
    );
  const base = norm(baseline);
  return [...norm(after)].filter((line) => !base.has(line));
}
