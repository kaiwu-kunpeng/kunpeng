import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";

// 审计 B §3 M15/M16：把两类注入检测分支关掉，全量仍绿。本流的交付物是实现者新写的行为测试 TARGET；
// 这里不改任何源码文件，而是把源码拷一份到临时目录做变异，用 vitest alias 让 TARGET 加载变异体，
// 断言 TARGET 在真源码上全绿、在每个变异体上因断言失败变红。
const ORCH = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TARGET = "test/security/injection-risk-branches.test.ts";
const VITEST_BIN = join(ORCH, "node_modules/vitest/vitest.mjs");
const SHIELD = join(ORCH, "src/security/prompt-shield.ts");
const SKILL = join(ORCH, "src/skills/skill-safety.ts");
const SHIELD_IMPORT = /^(?:\.\.?\/)+(?:src\/)?security\/prompt-shield\.js$/;
const SKILL_IMPORT = /^(?:\.\.?\/)+(?:src\/)?skills\/skill-safety\.js$/;

const DAE_BRANCH = '  if (downloadAndExecute(text)) {\n    reasons.push("download-and-execute");';
const EXFIL_BRANCH = '  if (matchesAny(text, KNOWN_EXFILTRATION_DOMAIN_PATTERNS)) {\n    reasons.push("known-exfiltration-domain");';
const SKILL_INJECTION = "for (const reason of classifyInjectionRisk(markdown).reasons) reasons.add(`injection:${reason}`);";

interface Mutant { id: string; source: string; find: RegExp; from: string; to: string }
const MUTANTS: Mutant[] = [
  { id: "M15 下载即执行分支关掉", source: SHIELD, find: SHIELD_IMPORT, from: DAE_BRANCH, to: DAE_BRANCH.replace("downloadAndExecute(text)", "false") },
  { id: "M15' 下载即执行分支恒真", source: SHIELD, find: SHIELD_IMPORT, from: DAE_BRANCH, to: DAE_BRANCH.replace("downloadAndExecute(text)", "true") },
  { id: "M16 外传域名分支关掉", source: SHIELD, find: SHIELD_IMPORT, from: EXFIL_BRANCH, to: EXFIL_BRANCH.replace("matchesAny(text, KNOWN_EXFILTRATION_DOMAIN_PATTERNS)", "false") },
  { id: "M16' 外传域名分支恒真", source: SHIELD, find: SHIELD_IMPORT, from: EXFIL_BRANCH, to: EXFIL_BRANCH.replace("matchesAny(text, KNOWN_EXFILTRATION_DOMAIN_PATTERNS)", "true") },
  {
    id: "SK 技能扫描丢掉 download-and-execute",
    source: SKILL,
    find: SKILL_IMPORT,
    from: SKILL_INJECTION,
    to: SKILL_INJECTION.replace(".reasons)", '.reasons.filter((r) => r !== "download-and-execute"))'),
  },
];

function runTarget(mutant?: Mutant): { status: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "kp-mutant-"));
  try {
    let alias = "[]";
    if (mutant) {
      const original = readFileSync(mutant.source, "utf8");
      expect(original.split(mutant.from).length - 1, `${mutant.id}：变异点应在源码里恰好出现一次`).toBe(1);
      const mutated = original.replace(mutant.from, mutant.to).replace('"../security/prompt-shield.js"', JSON.stringify(SHIELD));
      const file = join(dir, mutant.source === SHIELD ? "prompt-shield.ts" : "skill-safety.ts");
      writeFileSync(file, mutated);
      alias = `[{ find: ${mutant.find.toString()}, replacement: ${JSON.stringify(file)} }]`;
    }
    const config = join(dir, "vitest.mutant.config.mjs");
    writeFileSync(config, `export default { root: ${JSON.stringify(ORCH)}, resolve: { alias: ${alias} }, test: { include: [${JSON.stringify(TARGET)}], setupFiles: ["./test/vitest-setup.ts"] } };\n`);
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("VITEST") || key === "KUNPENG_BACKEND") delete env[key];
    const run = spawnSync(process.execPath, [VITEST_BIN, "run", "--config", config], { cwd: ORCH, env, encoding: "utf8", timeout: 120_000 });
    // 子进程可能继承强制彩色输出；只去掉终端格式，保留退出码与全部结果文本供原断言检查。
    return { status: run.status, output: stripVTControlCharacters(`${run.stdout ?? ""}\n${run.stderr ?? ""}`) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("注入检测两类硬拦的测试有抓力（作者锁定变异断言）", () => {
  it("交付物 TARGET 存在", () => {
    expect(existsSync(join(ORCH, TARGET)), `${TARGET} 应由本流新建`).toBe(true);
  });

  it("TARGET 在真源码上全绿", () => {
    const run = runTarget();
    expect(run.output).toMatch(/Tests\s+\d+ passed/);
    expect(run.output).not.toMatch(/\d+ failed/);
    expect(run.status, run.output.slice(-2000)).toBe(0);
  }, 180_000);

  it.each(MUTANTS.map((mutant) => [mutant.id, mutant] as const))("变异体「%s」让 TARGET 因断言失败变红", (_id, mutant) => {
    const run = runTarget(mutant);
    expect(run.status).not.toBe(0);
    expect(run.output, run.output.slice(-2000)).toMatch(/Tests\s+\d+ failed/);
  }, 180_000);
});
