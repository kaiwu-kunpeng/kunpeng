import { stableHash, type ReinjectTask } from "../feedback/finding-to-task.js";
import type { ProposedChange } from "../loop/self-evolution.js";
import { conventionsChangeProblems } from "./conventions-guard.js";
import { route } from "./route.js";

export const CONVENTIONS_BACKLOG_PREFIX = "[proposal-conventions]";
export const CONVENTIONS_BACKLOG_SOURCE = "proposal:conventions";
export const CONVENTIONS_TARGET_REL = "constitution/conventions.md";

export function acceptanceAnchor(text: string): string {
  let longest = "";
  for (const part of text.split(/['"`$\\\r\n]/)) {
    const trimmed = part.trim();
    if (trimmed.length > longest.length) longest = trimmed;
  }
  return longest.slice(0, 40).trim();
}

export function conventionsBacklogTask(changes: ProposedChange[]): ReinjectTask {
  const texts = changes.map((change) => change.text.trim());
  const acceptance = texts.map(acceptanceAnchor).filter((anchor) => anchor.length > 0)
    .map((anchor) => `grep -qF -- '${anchor}' ${CONVENTIONS_TARGET_REL}`).join(" && ");
  return {
    fingerprint: stableHash(`${CONVENTIONS_BACKLOG_SOURCE}|${texts.join("\n")}`),
    source: CONVENTIONS_BACKLOG_SOURCE,
    severity: "error",
    requirement: [
      `${CONVENTIONS_BACKLOG_PREFIX} 追加 ${texts.length} 条已批准的进化约定到 constitution/conventions.md`,
      '只改 constitution/conventions.md 这一个文件：在文件末尾逐条追加下列约定，每条独占一行、以 "- " 开头、原文一字不改、文件末尾保持恰好一个换行；某条原文已存在则跳过该条。',
      "绝不改 constitution/core.md、constitution/roles/ 下任何文件、AGENTS.md 与任何源码/测试。",
      "spec 必须单 H1（分节用粗体，不用 ##），必带 scope 块（每行一条）：",
      "allow: constitution/conventions.md",
      "forbid: constitution/core.md",
      "forbid: constitution/roles/**",
      "验收命令原样使用下面这一条（不得改写、不得删减）：",
      acceptance,
      "待追加的约定（原文）：",
      ...changes.map((change) => `- ${change.text.trim()}\n（源 ${change.source}）`),
    ].join("\n"),
  };
}

export interface BacklogApplierDeps {
  readConventions(mdPath: string): Promise<string>;
  enqueue(task: ReinjectTask): Promise<{ added: string[]; skipped: string[] }>;
  onEnqueued?(task: ReinjectTask): void;
}

export function backlogConventionsApplier(deps: BacklogApplierDeps): (
  mdPath: string,
  changes: ProposedChange[],
) => Promise<{ appended: string[]; skipped: string[] }> {
  return async (mdPath, changes) => {
    const content = await deps.readConventions(mdPath).catch(() => "");
    const appended: string[] = [];
    const skipped: string[] = [];
    const remaining: ProposedChange[] = [];
    for (const change of changes) {
      if (content.includes(change.text.trim())) {
        skipped.push(change.text);
      } else {
        appended.push(change.text);
        remaining.push(change);
      }
    }
    if (!remaining.length) return { appended, skipped };
    const task = conventionsBacklogTask(remaining);
    await deps.enqueue(task);
    deps.onEnqueued?.(task);
    return { appended, skipped };
  };
}

export function conventionsLanded(conventionsText: string, changes: ProposedChange[]): boolean {
  const texts = route(changes).conventions.map((change) => change.text.trim())
    .filter((text) => conventionsChangeProblems(text).length === 0);
  return texts.length > 0 && texts.every((text) => conventionsText.includes(text));
}
