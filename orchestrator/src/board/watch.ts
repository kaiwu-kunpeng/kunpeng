// 跨工具看板聚合 · watch 列表：除中央注册表外，额外纳入「和 codex 等工具聊的项目」。
// `~/.kunpeng/boards.json` = [repoPath...]；总控台读各项目 .kunpeng/board.json（parseBoard）显示在同一面。
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseBoard } from "./parse-board.js";
import type { Board } from "./board-render.js";

const watchPath = (stateDir: string) => join(stateDir, "boards.json");

/** 读 watch 列表（repoPath 数组）；缺失/坏档返回空。 */
export async function readWatchList(stateDir: string): Promise<string[]> {
  try {
    const a = JSON.parse(await readFile(watchPath(stateDir), "utf8"));
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

/** 把一个项目路径加入 watch 列表（去重），返回新列表。 */
export async function addWatch(stateDir: string, repoPath: string): Promise<string[]> {
  const list = await readWatchList(stateDir);
  if (!list.includes(repoPath)) list.push(repoPath);
  await mkdir(stateDir, { recursive: true });
  await writeFile(watchPath(stateDir), JSON.stringify(list, null, 2), "utf8");
  return list;
}

/** 读 watch 列表里各项目的 .kunpeng/board.json，parseBoard 解析成 Board[]（跨工具，谁写的都行）。 */
export async function collectExternalBoards(stateDir: string): Promise<Board[]> {
  const list = await readWatchList(stateDir);
  const boards: Board[] = [];
  for (const repoPath of list) {
    try {
      const b = parseBoard(await readFile(join(repoPath, ".kunpeng", "board.json"), "utf8"));
      if (b) boards.push(b);
    } catch { /* 无 board.json / 读不了：跳过 */ }
  }
  return boards;
}
