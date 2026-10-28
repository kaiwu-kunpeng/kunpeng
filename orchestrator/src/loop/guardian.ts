import { exec } from "node:child_process";

export type Severity = "info" | "warn" | "error";
export interface Scanner { name: string; severity: Severity; cmd: string; }
export interface Finding { scanner: string; severity: Severity; file?: string; line?: number; message: string; }

// 默认确定性扫描器（C8）：只用 shell 命令。grep -n 输出 file:line:text。
// 不用 `|| true`：靠 runScanner 区分 grep 的 exit 1(无匹配,正常) 与 exit>1(真错误)，
// 这样真 linter 崩溃不会被静默当成"无发现"。
// 只匹配注释形式的 TODO/FIXME（//、#、/* 开头），避免扫到 grep 模式字符串本身（自匹配误报）。
export const DEFAULT_SCANNERS: Scanner[] = [
  { name: "todo", severity: "info", cmd: "grep -rEn --include='*.ts' '(//|#|/\\*)[[:space:]]*(TODO|FIXME)' src" },
  // 单 grep + --exclude（不用管道+|| true）：与 todo 同姿态——exit 1=无匹配当无发现、exit≥2=真崩冒泡，不静默吞扫描失败。
  { name: "sync-fs", severity: "warn", cmd: "grep -rEn --include='*.ts' --exclude='*.test.ts' --exclude-dir=test --exclude-dir=scripts '(readFileSync|writeFileSync|existsSync)\\(' src" },
  { name: "console-log", severity: "info", cmd: "grep -rEn --include='*.ts' --exclude='cli.ts' --exclude-dir=test 'console\\.log\\(' src" },
];

function parseGrepLine(line: string): { file?: string; line?: number; message: string } {
  const m = line.match(/^(.+?):(\d+):(.*)$/);
  if (m) return { file: m[1], line: Number(m[2]), message: m[3].trim() };
  return { message: line };
}

function runScanner(cwd: string, scanner: Scanner): Promise<Finding[]> {
  return new Promise((resolve) => {
    exec(scanner.cmd, {
      cwd,
      shell: "/bin/bash",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 300_000,
    }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: number }).code === "number" ? (err as { code: number }).code : err ? 1 : 0;
      // 滤掉 npm/yarn 跑脚本时的横幅行（`> pkg@ver script` / `> tsc --noEmit`），
      // 它们恒打到 stdout，却不是真发现——否则一个通过的 `npm run typecheck` 会冒 2 条假 error。
      const lines = stdout.split("\n").filter((l) => l.trim() && !/^>\s/.test(l));
      // 有 stdout 就逐行当 findings：tsc/lint 把错误打到 stdout、退出码常 >1，绝不因退出码丢掉这些发现。
      if (lines.length) {
        resolve(lines.map((l) => ({ scanner: scanner.name, severity: scanner.severity, ...parseGrepLine(l) })));
        return;
      }
      // 无可解析输出但退出码异常(>1，grep 的 1=无匹配除外) = 扫描器真的崩了，冒泡成 error。
      if (code > 1) {
        resolve([{ scanner: scanner.name, severity: "error", message: `扫描器执行失败(exit ${code}): ${String(stderr).trim().slice(0, 200)}` }]);
        return;
      }
      resolve([]); // exit 0/1 且无输出 = 无发现
    });
  });
}

export async function runGuardian(cwd: string, scanners: Scanner[] = DEFAULT_SCANNERS): Promise<Finding[]> {
  const all: Finding[] = [];
  for (const s of scanners) all.push(...(await runScanner(cwd, s)));
  return all;
}
