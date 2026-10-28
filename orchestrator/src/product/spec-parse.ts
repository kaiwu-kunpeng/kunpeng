export interface ParsedSpecBriefFields {
  idea?: string;
  problem?: string;
  users?: string[];
  stories?: string[];
}

function parseAnchoredText(lines: string[], anchor: string): string | undefined {
  const line = lines.find((candidate) => candidate.includes(anchor));
  if (line === undefined) return undefined;

  const separator = line.indexOf("：", line.indexOf(anchor) + anchor.length);
  if (separator === -1) return undefined;

  const value = line.slice(separator + 1).trim();
  return value === "" ? undefined : value;
}

function parseAnchoredList(lines: string[], anchor: string): string[] | undefined {
  const anchorIndex = lines.findIndex((line) => line.includes(anchor));
  if (anchorIndex === -1) return undefined;

  const values: string[] = [];
  for (let index = anchorIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.startsWith("- ")) break;

    const value = line.slice(2).trim();
    if (value !== "") values.push(value);
  }

  return values.length === 0 ? undefined : values;
}

export function parseSpecBriefFields(specText: string): ParsedSpecBriefFields {
  if (typeof specText !== "string" || specText === "") return {};

  const lines = specText.split(/\r?\n/);
  const parsed: ParsedSpecBriefFields = {};

  const title = lines.map((line) => /^# 段一：(.+)$/.exec(line)).find((match) => match !== null)?.[1]?.trim();
  if (title !== undefined && title !== "" && title !== "（未命名需求）") parsed.idea = title;

  const problem = parseAnchoredText(lines, "[prfaq-problem]");
  if (problem !== undefined) parsed.problem = problem;

  const users = parseAnchoredList(lines, "[prfaq-users]");
  if (users !== undefined) parsed.users = users;

  const stories = parseAnchoredList(lines, "[prfaq-scenarios]");
  if (stories !== undefined) parsed.stories = stories;

  return parsed;
}
