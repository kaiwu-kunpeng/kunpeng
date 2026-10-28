import simpleGit from "simple-git";
import { escHtml } from "../util/esc-html.js";

export interface GateDiffFile {
  path: string;
  status: string;
}

export interface GateDiffResult {
  ok: boolean;
  base: string;
  branch: string;
  files: GateDiffFile[];
  diff: string;
  html: string;
  error?: string;
}

function branchForFlow(flowId: string): string {
  const trimmed = flowId.trim();
  return trimmed.startsWith("kp/") ? trimmed : `kp/${trimmed}`;
}

function parseNameStatus(raw: string): GateDiffFile[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const status = parts[0] ?? "";
      const path = parts[parts.length - 1] ?? "";
      return { path, status };
    })
    .filter((file) => file.path.length > 0);
}

function renderDiffLine(line: string): string {
  const escaped = escHtml(line);
  if (line.startsWith("@@")) return `<span class="kp-diff-hunk">${escaped}</span>`;
  if (line.startsWith("+") && !line.startsWith("+++")) return `<span class="kp-diff-add">${escaped}</span>`;
  if (line.startsWith("-") && !line.startsWith("---")) return `<span class="kp-diff-del">${escaped}</span>`;
  return `<span class="kp-diff-ctx">${escaped}</span>`;
}

export function renderDiffHtml(diff: string): string {
  const body = diff.length > 0
    ? diff.split(/\r?\n/).map(renderDiffLine).join("\n")
    : `<span class="kp-diff-empty">无改动</span>`;
  return `<pre class="kp-diff">${body}</pre>`;
}

export async function gateDiff(repoRoot: string, flowId: string, base = "main"): Promise<GateDiffResult> {
  const branch = branchForFlow(flowId);
  const range = `${base}...${branch}`;
  const git = simpleGit(repoRoot);

  try {
    const [nameStatus, diff] = await Promise.all([
      git.raw(["diff", "--name-status", range]),
      git.raw(["diff", "--no-ext-diff", range]),
    ]);

    return {
      ok: true,
      base,
      branch,
      files: parseNameStatus(nameStatus),
      diff,
      html: renderDiffHtml(diff),
    };
  } catch (error) {
    const message = (error as Error).message || String(error);
    return {
      ok: false,
      base,
      branch,
      files: [],
      diff: "",
      html: renderDiffHtml(message),
      error: message,
    };
  }
}
