import { readFileSync, writeFileSync } from "node:fs";

export const CODEGRAPH_BEGIN = "<!-- kunpeng:codegraph:begin -->";
export const CODEGRAPH_END = "<!-- kunpeng:codegraph:end -->";

export function codegraphAgentsSection(): string {
  return [
    CODEGRAPH_BEGIN,
    "## codegraph MCP usage",
    "",
    "When exploring unfamiliar code, query the codegraph before falling back to grep. This keeps context focused, saves tokens, and reduces tool-call volume.",
    "",
    "Available MCP tools:",
    "- `codegraph_search`",
    "- `codegraph_callers`",
    "- `codegraph_callees`",
    "- `codegraph_context`",
    CODEGRAPH_END,
  ].join("\n");
}

export function injectIntoAgentsMd(filePath: string): void {
  const content = readExistingFile(filePath);
  const section = codegraphAgentsSection();
  const start = content.indexOf(CODEGRAPH_BEGIN);
  const end = content.indexOf(CODEGRAPH_END, start + CODEGRAPH_BEGIN.length);

  if (start >= 0 && end >= 0) {
    const afterEnd = end + CODEGRAPH_END.length;
    writeFileSync(filePath, `${content.slice(0, start)}${section}${content.slice(afterEnd)}`);
    return;
  }

  const prefix = content.length === 0 ? "" : `${content.trimEnd()}\n\n`;
  writeFileSync(filePath, `${prefix}${section}`);
}

function readExistingFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if (isNoEntryError(error)) {
      return "";
    }
    throw error;
  }
}

function isNoEntryError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
