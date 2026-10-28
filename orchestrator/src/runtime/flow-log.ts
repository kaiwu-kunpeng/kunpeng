import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface ResolvedFlowLog {
  logPath: string;
  /** true=本进程自己铸的路径(CLI 直跑,stdout 在终端,调用方需 tee console);
   *  false=来自 env(cockpit 启动,stdio 已被父进程重定向到该文件,调用方不得再 tee,否则双写)。 */
  minted: boolean;
}

/** 决定本流日志路径。cockpit 经 env `KUNPENG_FLOW_LOG` 注入 -> 原样返回、minted=false;
 *  CLI 直跑(env 空)-> 在 <repoRoot>/.kunpeng/cockpit/logs/ 铸一个新文件路径、minted=true。
 *  与 launchKunpeng 同目录,驾驶舱 /api/flow-log 的越界校验(logsRoot)才放行。 */
export function resolveFlowLog(repoRoot: string, slugHint?: string, now: () => number = Date.now): ResolvedFlowLog {
  const fromEnv = process.env.KUNPENG_FLOW_LOG;
  if (fromEnv && fromEnv.trim()) return { logPath: fromEnv, minted: false };
  const logDir = join(repoRoot, ".kunpeng", "cockpit", "logs");
  mkdirSync(logDir, { recursive: true });
  const slug = (slugHint ?? "cli").replace(/[^a-z0-9]+/gi, "-").slice(0, 20) || "cli";
  const logPath = join(logDir, `${slug}-${now().toString(36)}-${randomBytes(4).toString("hex")}.log`);
  return { logPath, minted: true };
}

/** 把 console.log/error/warn 各复制一份同步追加进 logPath(CLI 直跑进程 stdout 在终端,不会自动落文件)。
 *  返回还原函数。写文件失败一律静默吞掉--日志是观测增强,绝不可挡主流程(fail-open)。 */
export function teeConsoleToFile(logPath: string): () => void {
  const orig = { log: console.log, error: console.error, warn: console.warn };
  const append = (args: unknown[]) => {
    try {
      appendFileSync(logPath, args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n");
    } catch {
      /* 观测增强,吞掉 */
    }
  };
  console.log = (...a: unknown[]) => {
    append(a);
    orig.log(...a);
  };
  console.error = (...a: unknown[]) => {
    append(a);
    orig.error(...a);
  };
  console.warn = (...a: unknown[]) => {
    append(a);
    orig.warn(...a);
  };
  return () => {
    console.log = orig.log;
    console.error = orig.error;
    console.warn = orig.warn;
  };
}
