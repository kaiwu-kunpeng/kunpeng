import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { codegraphAgentsSection } from "../codegraph/inject.js";

export interface CompileInput { kunpengRoot: string; outFile: string; }
export interface CompileResult { path: string; clobberAvoided: boolean; pointerEnsured?: boolean }

// 鲲鹏生成物的标记。重编译会覆盖自己生成的文件（幂等），但绝不覆盖别人写的 AGENTS.md。
const MARKER = "鲲鹏编译产出";
const POINTER_BEGIN = "<!-- KUNPENG-POINTER:BEGIN -->";
const POINTER_END = "<!-- KUNPENG-POINTER:END -->";
const POINTER_BLOCK = [
  POINTER_BEGIN,
  "> 🛰 **鲲鹏跨项目约定**：开工前必读 `.kunpeng/AGENTS.kunpeng.md`（不可协商规矩 + 可演进约定 + 角色 playbook，由鲲鹏 compile 自动刷新，勿手改）。",
  POINTER_END,
].join("\n");

export async function compileAgentsMd(input: CompileInput): Promise<CompileResult> {
  const core = await readFile(join(input.kunpengRoot, "constitution", "core.md"), "utf8");
  const conventions = await readFile(join(input.kunpengRoot, "constitution", "conventions.md"), "utf8");
  const rosterDir = join(input.kunpengRoot, "roster");
  const files = (await readdir(rosterDir)).filter((f) => f.endsWith(".role.md")).sort();
  const roster = (
    await Promise.all(files.map((f) => readFile(join(rosterDir, f), "utf8")))
  ).join("\n\n");

  const out = [
    `# AGENTS.md · ${MARKER}（跨工具真相源）`,
    "> 由 orchestrator/src/compile/agents-md.ts 生成，请改源后重编译，勿手改。",
    "",
    "## 不可协商的规矩（来自 constitution/core.md）",
    core,
    "",
    "## 可演进约定（来自 constitution/conventions.md）",
    conventions,
    "",
    "## 角色 playbook（按需实例化，非固定编制 · C9）",
    roster,
    "",
    codegraphAgentsSection(),
    "",
  ].join("\n");

  // 非覆盖：若目标已存在且不是鲲鹏生成的（没有 MARKER），改写到同目录 .kunpeng/AGENTS.kunpeng.md，
  // 绝不 clobber 别人的 AGENTS.md（成熟真项目通常已有自己的 214 行配置）。
  let target = input.outFile;
  let clobberAvoided = false;
  let existingOutFile = "";
  try {
    const existing = await readFile(input.outFile, "utf8");
    if (!existing.includes(MARKER)) {
      target = join(dirname(input.outFile), ".kunpeng", "AGENTS.kunpeng.md");
      clobberAvoided = true;
      existingOutFile = existing;
    }
  } catch { /* 不存在 → 直接写 outFile */ }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, out, "utf8");
  if (clobberAvoided) {
    if (!existingOutFile.includes(POINTER_BEGIN)) {
      const separator = existingOutFile.endsWith("\n") ? "\n" : "\n\n";
      await writeFile(input.outFile, `${existingOutFile}${separator}${POINTER_BLOCK}\n`, "utf8");
    }
    return { path: target, clobberAvoided, pointerEnsured: true };
  }
  return { path: target, clobberAvoided };
}
