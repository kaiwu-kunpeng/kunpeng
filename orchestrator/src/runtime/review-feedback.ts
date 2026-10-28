import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ReviewComment {
  comment: string;
  file?: string;
  line?: number;
}

// 专用目录 .kunpeng/review-feedback —— 不能用 .kunpeng/feedback(那是 ReinjectStore 飞轮 backlog 目录,
// 它 readdir 全部 *.json 当 ReinjectEntry 解析,放我们的 ReviewComment[] 进去会污染它的待办解析)。
export function feedbackPath(repoRoot: string, flowId: string): string {
  return join(repoRoot, ".kunpeng", "review-feedback", flowId + ".json");
}

export async function readFeedback(repoRoot: string, flowId: string): Promise<ReviewComment[]> {
  try {
    const raw = await readFile(feedbackPath(repoRoot, flowId), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as ReviewComment[] : [];
  } catch {
    // 反馈文件缺失、损坏或不可解析时，调用方按无反馈继续处理。
    return [];
  }
}

export async function addFeedback(repoRoot: string, flowId: string, comment: ReviewComment): Promise<void> {
  const filePath = feedbackPath(repoRoot, flowId);
  const comments = await readFeedback(repoRoot, flowId);
  comments.push(comment);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(comments, null, 2) + "\n", "utf8");
}

export async function clearFeedback(repoRoot: string, flowId: string): Promise<void> {
  await rm(feedbackPath(repoRoot, flowId), { force: true });
}

export function formatFeedbackForPrompt(comments: ReviewComment[]): string {
  if (comments.length === 0) {
    return "";
  }

  const lines = comments.map((comment) => {
    if (comment.file && comment.line !== undefined) {
      return `- [${comment.file}:${comment.line}] ${comment.comment}`;
    }
    if (comment.file) {
      return `- [${comment.file}] ${comment.comment}`;
    }
    return `- ${comment.comment}`;
  });

  return ["## 人工审查意见（请据此修正实现）", ...lines].join("\n");
}
