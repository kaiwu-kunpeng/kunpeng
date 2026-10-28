import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface GateComment {
  planId: string;
  file: string;
  text: string;
  at: number;
}

function commentsDir(dir: string): string {
  return join(dir, "gate-comments");
}

function commentsPath(dir: string, planId: string): string {
  return join(commentsDir(dir), `${planId}.jsonl`);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function renderComment(comment: GateComment, index: number): string {
  return `**评论 ${index + 1} · 文件：${comment.file}**\n\n<pre>\n${comment.text}\n</pre>`;
}

export function composeSendbackSpec(planId: string, comments: GateComment[]): string {
  const relevant = comments.filter((comment) => comment.planId === planId);
  const files = [...new Set(relevant.map((comment) => comment.file))];
  const scope = files.map((file) => `allow: ${file}`).join("\n");
  const body = relevant.map(renderComment).join("\n\n");

  return `# 评审回改:${planId}

\`\`\`scope
${scope}
\`\`\`

${body}

只按评论修改上述文件；不得回退/删除任何既有测试；不得改动范围外文件。

\`\`\`accept
cd orchestrator && npx tsc --noEmit -p tsconfig.json && npm run test:unit
\`\`\`
`;
}

export async function appendComment(dir: string, comment: GateComment): Promise<void> {
  const targetDir = commentsDir(dir);
  await mkdir(targetDir, { recursive: true });
  await appendFile(commentsPath(dir, comment.planId), `${JSON.stringify(comment)}\n`, "utf8");
}

export async function readComments(dir: string, planId: string): Promise<GateComment[]> {
  let raw: string;
  try {
    raw = await readFile(commentsPath(dir, planId), "utf8");
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }

  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as GateComment)
    .filter((comment) => comment.planId === planId);
}
