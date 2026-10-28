/**
 * action-parity —— 渲染端 data-action 属性与处理端认领的配对守门（纯函数，不触碰文件系统）。
 *
 * 渲染端（views / 模板）发出的每个静态 data-action 名都必须在处理端（client / client-parts）
 * 找到对应的带引号字面量，否则就是一颗「死按钮」。三个函数都由调用方传入源码（path + content），
 * 判定口径宁松勿严——处理端任何带引号形态都算认领。
 *
 * 注意：本文件刻意不写出 data-action 的完整属性字面量，以免被自身扫描误当成一颗渲染端 action。
 */

/** 一份待扫描的源码：文件路径 + 全文内容。 */
export interface SourceFile {
  path: string;
  text: string;
}

/** action 名：字母数字 + 连字符。 */
const ACTION = "[A-Za-z0-9-]+";
/** 渲染端静态字面量：data-action 属性（单双引号需成对，值为 action 名）。 */
const RENDER_RE = new RegExp(`data-action=(["'])(${ACTION})\\1`, "g");
/** 处理端认领：带引号字面量 "x" / 'x' / \`x\`（引号需成对）。 */
const HANDLE_RE = new RegExp("([\"'`])(" + ACTION + ")\\1", "g");

/**
 * 从渲染端收集 `data-action` 静态字面量。
 * @returns Map<action, 出现该 action 的文件路径列表>（按输入顺序、多文件归并、每文件去重）。
 */
export function collectRenderedActions(sources: readonly SourceFile[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const { path, text } of sources) {
    RENDER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RENDER_RE.exec(text)) !== null) {
      const action = m[2];
      let files = map.get(action);
      if (!files) {
        files = [];
        map.set(action, files);
      }
      if (!files.includes(path)) files.push(path);
    }
  }
  return map;
}

/**
 * 从处理端收集带引号字面量。任一带引号形态（===、case、映射表键、模板串等）即算认领。
 * @returns 认领到的 action 名集合。
 */
export function collectHandledActions(sources: readonly SourceFile[]): Set<string> {
  const set = new Set<string>();
  for (const { text } of sources) {
    HANDLE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HANDLE_RE.exec(text)) !== null) {
      set.add(m[2]);
    }
  }
  return set;
}

/**
 * 渲染端发出、但处理端完全找不到对应字面量的 action（死按钮）。
 * @returns `{ action, files }[]`，按 action 名字典序稳定排序。
 */
export function findUnhandledActions(
  renderSources: readonly SourceFile[],
  clientSources: readonly SourceFile[],
): { action: string; files: string[] }[] {
  const rendered = collectRenderedActions(renderSources);
  const handled = collectHandledActions(clientSources);
  const out: { action: string; files: string[] }[] = [];
  for (const [action, files] of rendered) {
    if (!handled.has(action)) out.push({ action, files });
  }
  out.sort((a, b) => (a.action < b.action ? -1 : a.action > b.action ? 1 : 0));
  return out;
}
