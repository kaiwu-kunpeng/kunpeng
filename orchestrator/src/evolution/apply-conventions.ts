import type { ProposedChange } from "../loop/self-evolution.js";
import { readFile, writeFile } from "node:fs/promises";

/**
 * 约定落地器（确定性、幂等 · C8）。
 *
 * 把通过人工门 #2 的 conventions 条目以 bullet 追加进给定的约定 md 文件。
 * 绝不读写 core/宪法——写入目标仅为传入的 `mdPath`（C6 护栏①）。
 *
 * 行为：
 *   - 已含某条 `change.text` 子串 → 计入 skipped，不追加（幂等）。
 *   - 否则把 `- ${change.text}` 追加到末尾 → 计入 appended。
 *   - 写回后文件末尾恰好一个换行符，不堆叠空行。
 *   - appended/skipped 均按输入顺序记录条目文本。
 */
export async function applyConventions(
  mdPath: string,
  changes: ProposedChange[],
): Promise<{ appended: string[]; skipped: string[] }> {
  const appended: string[] = [];
  const skipped: string[] = [];

  const content = await readFile(mdPath, "utf8");
  // 去掉尾部空白/换行，统一以「正文 + 单个换行」收尾，避免空行堆叠。
  let body = content.replace(/\s*$/, "");

  for (const change of changes) {
    // 去重：当前内容（含本批已追加）已含该文本即跳过——保证幂等。
    if (body.includes(change.text)) {
      skipped.push(change.text);
      continue;
    }
    body = body.length ? `${body}\n- ${change.text}` : `- ${change.text}`;
    appended.push(change.text);
  }

  const next = `${body}\n`;
  if (next !== content) await writeFile(mdPath, next, "utf8");
  return { appended, skipped };
}
