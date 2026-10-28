// 落盘编排 codegen —— codegen 的 IO 出口薄层。
// 唯一职责：mkdir -p outDir，把契约委派给下游纯函数渲染，落盘 4 个产物，汇总返回。
// 本层无模板字符串、不调 LLM（C8 确定性优先）；渲染全部委派 codegen-tokens / codegen-scaffold。
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesignContract } from "./contract.js";
import { renderTailwindTheme, renderTokensCss } from "./codegen-tokens.js";
import { renderShadcnInstall, renderStarterPage } from "./codegen-scaffold.js";

/** 一个落盘产物的种类标识（与渲染来源一一对应）。 */
export type EmittedKind = "tokens-css" | "tailwind-theme" | "shadcn-install" | "starter-page";

/** 一个已落盘的产物：绝对/相对路径 + 其种类。 */
export interface EmittedFile {
  /** 落盘路径（outDir 下的具体文件）。 */
  path: string;
  /** 产物种类。 */
  kind: EmittedKind;
}

/** 产物清单：文件名 → 种类 → 下游渲染纯函数。落盘顺序即此表顺序。 */
const ARTIFACTS: ReadonlyArray<{
  file: string;
  kind: EmittedKind;
  render: (c: DesignContract) => string;
}> = [
  { file: "globals.css", kind: "tokens-css", render: renderTokensCss },
  { file: "tailwind.theme.css", kind: "tailwind-theme", render: renderTailwindTheme },
  { file: "INSTALL.md", kind: "shadcn-install", render: renderShadcnInstall },
  { file: "starter.html", kind: "starter-page", render: renderStarterPage },
];

/**
 * 把设计契约落盘为 codegen 产物：先建目录，再逐个委派下游纯函数渲染并写入。
 *
 * @param contract 已解析的设计契约（真相源）。
 * @param outDir   产物输出目录（递归创建）。
 * @returns 已落盘产物清单（与 ARTIFACTS 顺序一致）。
 */
export async function emitDesignCode(
  contract: DesignContract,
  outDir: string,
): Promise<EmittedFile[]> {
  await mkdir(outDir, { recursive: true });

  const emitted: EmittedFile[] = [];
  for (const artifact of ARTIFACTS) {
    const path = join(outDir, artifact.file);
    await writeFile(path, artifact.render(contract), "utf8");
    emitted.push({ path, kind: artifact.kind });
  }
  return emitted;
}
