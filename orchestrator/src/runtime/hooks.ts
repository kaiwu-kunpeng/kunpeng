import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface HooksConfig { preMerge?: string[]; }
export interface HookFailure { command: string; output: string; }
export interface HookOutcome { ok: boolean; failures: HookFailure[]; }
export type ShellRunner = (command: string, cwd: string) => Promise<{ code: number; output: string }>;

/** 解析 hooks.json 文本:取 preMerge 字符串数组(过滤非字符串项);非法/缺失 → {}。不抛。 */
export function parseHooksConfig(raw: string): HooksConfig {
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return {}; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const pre = (obj as Record<string, unknown>).preMerge;
  if (!Array.isArray(pre)) return {};
  return { preMerge: pre.filter((c): c is string => typeof c === "string") };
}

/** 依次跑命令;非零退出计入 failures;ok = 无 failure。注入 run 便于测试。 */
export async function evaluatePreMerge(commands: string[], cwd: string, run: ShellRunner): Promise<HookOutcome> {
  const failures: HookFailure[] = [];
  for (const command of commands) {
    const { code, output } = await run(command, cwd);
    if (code !== 0) failures.push({ command, output });
  }
  return { ok: failures.length === 0, failures };
}

const defaultRunner: ShellRunner = (command, cwd) => new Promise((resolve) => {
  exec(command, { cwd, timeout: 120_000 }, (err, stdout, stderr) => {
    const code = err && typeof (err as { code?: unknown }).code === "number"
      ? (err as { code: number }).code : err ? 1 : 0;
    resolve({ code, output: `${stdout}${stderr}` });
  });
});

/** 读 <repoRoot>/.kunpeng/hooks.json 的 preMerge 命令并依次跑;无配置/无 preMerge=直接 ok。 */
export async function runPreMergeHooks(repoRoot: string, run: ShellRunner = defaultRunner): Promise<HookOutcome> {
  const raw = await readFile(join(repoRoot, ".kunpeng", "hooks.json"), "utf8").catch(() => "");
  const config = parseHooksConfig(raw);
  if (!config.preMerge?.length) return { ok: true, failures: [] };
  return evaluatePreMerge(config.preMerge, repoRoot, run);
}
