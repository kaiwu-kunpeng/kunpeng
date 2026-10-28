import { execFile as nodeExecFile } from "node:child_process";
import { writeFile } from "node:fs/promises";

export type OfficeKind = "docx" | "pptx" | "xlsx";

export type ExecFileLike = (
  file: string,
  args: string[],
  options: { encoding: "utf8"; maxBuffer: number; timeout: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => unknown;

export interface UploadExtractDeps {
  execFile?: ExecFileLike;
}

const UNZIP = "/usr/bin/unzip";
const OUTPUT_LIMIT = 200_000;
const MAX_UNZIP_BUFFER = 128 * 1024 * 1024;
const UNZIP_TIMEOUT_MS = 30_000;

export function officeKind(name: string): OfficeKind | null {
  const match = /\.([^.\\/]+)$/.exec(name.trim());
  const ext = match?.[1]?.toLowerCase();
  return ext === "docx" || ext === "pptx" || ext === "xlsx" ? ext : null;
}

function decodeXmlEntity(entity: string): string {
  const named: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
  };
  if (entity in named) return named[entity];
  const hex = /^&#x([0-9a-f]+);$/i.exec(entity);
  const decimal = /^&#(\d+);$/.exec(entity);
  const codePoint = hex ? Number.parseInt(hex[1], 16) : decimal ? Number.parseInt(decimal[1], 10) : NaN;
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return entity;
  return String.fromCodePoint(codePoint);
}

export function stripXmlText(xml: string): string {
  return xml
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, decodeXmlEntity)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\r\n]+/g, " ").trim())
    .join("\n")
    .trim();
}

async function runUnzip(args: string[], deps: UploadExtractDeps): Promise<string> {
  const execFile = deps.execFile ?? nodeExecFile as unknown as ExecFileLike;
  return new Promise<string>((resolve, reject) => {
    execFile(UNZIP, args, {
      encoding: "utf8",
      maxBuffer: MAX_UNZIP_BUFFER,
      timeout: UNZIP_TIMEOUT_MS,
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function numberedEntries(listing: string, pattern: RegExp): { number: number; path: string }[] {
  const entries: { number: number; path: string }[] = [];
  for (const path of listing.split(/\r?\n/)) {
    const match = pattern.exec(path);
    if (match) entries.push({ number: Number.parseInt(match[1], 10), path });
  }
  return entries.sort((a, b) => a.number - b.number);
}

function sharedStringsFrom(xml: string): string[] {
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi), (match) => stripXmlText(match[1]));
}

function cellValue(attributes: string, body: string, sharedStrings: string[]): string {
  const type = /\bt\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];
  if (type === "s") {
    const rawIndex = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(body)?.[1] ?? "";
    const index = Number.parseInt(stripXmlText(rawIndex), 10);
    return Number.isInteger(index) ? sharedStrings[index] ?? "" : "";
  }
  const inline = /<is\b[^>]*>([\s\S]*?)<\/is>/i.exec(body)?.[1];
  if (inline !== undefined) return stripXmlText(inline);
  const value = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(body)?.[1];
  return value === undefined ? "" : stripXmlText(value);
}

function worksheetText(xml: string, sharedStrings: string[]): string {
  const rows: string[] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      cells.push(cellValue(cell[1], cell[2], sharedStrings));
    }
    rows.push(cells.join("\t"));
  }
  return rows.join("\n");
}

function limitOutput(text: string): { text: string; truncated: boolean } {
  if (text.length <= OUTPUT_LIMIT) return { text, truncated: false };
  const suffix = `…[截断:全文 ${text.length} 字符]`;
  return {
    text: `${text.slice(0, Math.max(0, OUTPUT_LIMIT - suffix.length))}${suffix}`,
    truncated: true,
  };
}

export async function extractOfficeText(
  filePath: string,
  kind: OfficeKind,
  deps: UploadExtractDeps = {},
): Promise<{ text: string; truncated: boolean }> {
  let text: string;
  if (kind === "docx") {
    const xml = await runUnzip(["-p", filePath, "word/document.xml"], deps);
    text = stripXmlText(xml.replace(/<\/w:p\s*>/gi, "</w:p>\n"));
  } else if (kind === "pptx") {
    const listing = await runUnzip(["-Z1", filePath], deps);
    const slides = numberedEntries(listing, /^ppt\/slides\/slide(\d+)\.xml$/i);
    if (slides.length === 0) throw new Error("pptx 中没有幻灯片条目");
    const pages: string[] = [];
    for (const slide of slides) {
      const xml = await runUnzip(["-p", filePath, slide.path], deps);
      pages.push(`【第${slide.number}页】\n${stripXmlText(xml)}`.trim());
    }
    text = pages.join("\n");
  } else {
    const sharedXml = await runUnzip(["-p", filePath, "xl/sharedStrings.xml"], deps);
    const sharedStrings = sharedStringsFrom(sharedXml);
    const listing = await runUnzip(["-Z1", filePath], deps);
    const sheets = numberedEntries(listing, /^xl\/worksheets\/sheet(\d+)\.xml$/i);
    if (sheets.length === 0) throw new Error("xlsx 中没有工作表条目");
    const sections: string[] = [];
    for (const sheet of sheets) {
      const xml = await runUnzip(["-p", filePath, sheet.path], deps);
      sections.push(`【Sheet ${sheet.number}】\n${worksheetText(xml, sharedStrings)}`.trim());
    }
    text = sections.join("\n");
  }
  return limitOutput(text);
}

export async function extractToSidecar(
  filePath: string,
  name: string,
  deps: UploadExtractDeps = {},
): Promise<string | null> {
  const kind = officeKind(name);
  if (!kind) return null;
  try {
    const result = await extractOfficeText(filePath, kind, deps);
    const sidecarPath = `${filePath}.extracted.txt`;
    await writeFile(sidecarPath, result.text, "utf8");
    return sidecarPath;
  } catch {
    return null;
  }
}
