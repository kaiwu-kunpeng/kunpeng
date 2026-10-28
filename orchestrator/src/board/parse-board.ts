import type { Board } from "./board-render.js";

export function parseBoard(text: string): Board | null {
  try {
    const parsed = JSON.parse(text);

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    if (parsed.schema !== "kunpeng-board/v1") {
      return null;
    }

    if (!parsed.project || typeof parsed.project !== "object") {
      return null;
    }

    if (
      typeof parsed.project.id !== "string"
      || typeof parsed.project.name !== "string"
      || typeof parsed.project.repoPath !== "string"
    ) {
      return null;
    }

    return parsed as Board;
  } catch {
    return null;
  }
}
