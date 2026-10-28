import { existsSync, readFileSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { escHtml } from "../../util/esc-html.js";
import { registerModularRoute } from "./registry.js";

function inlineToHtml(value: string): string {
  const escaped = escHtml(value);
  let html = "";
  let cursor = 0;

  while (cursor < escaped.length) {
    if (escaped[cursor] === "`") {
      const end = escaped.indexOf("`", cursor + 1);
      if (end >= 0) {
        html += `<code>${escaped.slice(cursor + 1, end)}</code>`;
        cursor = end + 1;
        continue;
      }
    }

    if (escaped.startsWith("**", cursor)) {
      const end = escaped.indexOf("**", cursor + 2);
      if (end >= 0) {
        html += `<strong>${escaped.slice(cursor + 2, end)}</strong>`;
        cursor = end + 2;
        continue;
      }
    }

    if (escaped[cursor] === "[") {
      const labelEnd = escaped.indexOf("](", cursor + 1);
      const hrefEnd = labelEnd >= 0 ? escaped.indexOf(")", labelEnd + 2) : -1;
      if (labelEnd >= 0 && hrefEnd >= 0) {
        const label = escaped.slice(cursor + 1, labelEnd);
        const href = escaped.slice(labelEnd + 2, hrefEnd);
        if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("?page=")) {
          html += `<a href="${href}">${label}</a>`;
        } else {
          html += label;
        }
        cursor = hrefEnd + 1;
        continue;
      }
    }

    html += escaped[cursor];
    cursor += 1;
  }

  return html;
}

export function mdToHtml(md: string): string {
  const lines = md.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const output: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let codeLines: string[] | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    output.push(`<p>${paragraph.map(inlineToHtml).join("\n")}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (listItems.length === 0) return;
    output.push(`<ul>${listItems.map((item) => `<li>${inlineToHtml(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };
  const flushCode = (): void => {
    if (codeLines === null) return;
    output.push(`<pre><code>${codeLines.map(escHtml).join("\n")}</code></pre>`);
    codeLines = null;
  };

  for (const line of lines) {
    if (codeLines !== null) {
      if (/^\s*```\s*$/.test(line)) flushCode();
      else codeLines.push(line);
      continue;
    }

    if (/^\s*```/.test(line)) {
      flushParagraph();
      flushList();
      codeLines = [];
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineToHtml(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = /^\s*[-*]\s+(.*)$/.exec(line);
    if (listItem) {
      flushParagraph();
      listItems.push(listItem[1]);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  flushCode();
  return output.join("\n");
}

export function resolveHelpPage(helpDir: string, page: string | null): string | null {
  const root = resolve(helpDir);
  if (page === null || page === "") return join(root, "README.md");
  if (page.startsWith("/") || isAbsolute(page)) return null;
  if (!/^[A-Za-z0-9_/.-]+\.md$/.test(page) || page.includes("..")) return null;

  const candidate = resolve(root, page);
  if (!candidate.startsWith(`${root}${sep}`)) return null;
  return candidate;
}

function pageShell(content: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>鲲鹏帮助</title>
  <style>
    :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;color:#1f2937;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;line-height:1.7}main{max-width:860px;margin:0 auto;padding:32px 24px 64px}nav{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:30px;padding-bottom:16px;border-bottom:1px solid #dbe3ec}a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}h1,h2,h3{color:#111827;line-height:1.3;margin:1.5em 0 .6em}p,ul{margin:.8em 0}pre{overflow:auto;padding:16px;border-radius:8px;background:#eef2f7}code{padding:.12em .35em;border-radius:4px;background:#eef2f7;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}pre code{padding:0;background:transparent}
  </style>
</head>
<body><main><nav><a href="/help">返回 /help 目录</a><a href="/">返回总控台 /</a></nav><article>${content}</article></main></body>
</html>`;
}

function sendNotFound(res: ServerResponse): void {
  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
  res.end(pageShell("<h1>帮助页面不存在</h1><p>请返回帮助目录重新选择。</p>"));
}

registerModularRoute({
  method: "GET",
  path: "/help",
  handle: (_req, res, url, context) => {
    const helpDir = context.cliJs
      ? join(dirname(context.cliJs), "..", "..", "docs", "help")
      : join(process.cwd(), "docs", "help");
    const page = new URL(url, "http://localhost").searchParams.get("page");
    const file = resolveHelpPage(helpDir, page);
    if (!file || !existsSync(file)) {
      sendNotFound(res);
      return;
    }

    try {
      if (!statSync(file).isFile()) {
        sendNotFound(res);
        return;
      }
      const content = mdToHtml(readFileSync(file, "utf8"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(pageShell(content));
    } catch {
      sendNotFound(res);
    }
  },
});
