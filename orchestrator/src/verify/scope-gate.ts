import { TextDecoder } from "node:util";

export interface ScopeDecl {
  allow: string[];
  forbid: string[];
  malformed?: boolean;
}

export interface ScopeViolation {
  file: string;
  rule: "forbidden" | "outside-allow" | "scope-unparseable";
}

export interface ScopeDriftResult {
  ok: boolean;
  violations: ScopeViolation[];
}

export function parseScopeDeclaration(specText: string): ScopeDecl | undefined {
  const matches = specText.matchAll(/^```scope[ \t]*\r?\n([\s\S]*?)\r?\n```/gm);
  const scope: ScopeDecl = { allow: [], forbid: [] };
  let found = false;
  let hasMalformedLine = false;

  for (const match of matches) {
    found = true;
    let listKind: "allow" | "forbid" | undefined;

    for (const rawLine of match[1].split(/\r?\n/)) {
      const line = rawLine.trim();
      const keyMatch = /^(allow|forbid)\s*[:：]\s*(.*)$/i.exec(line);
      if (keyMatch) {
        listKind = keyMatch[1].toLowerCase() === "allow" ? "allow" : "forbid";
        pushScopeGlob(scope[listKind], keyMatch[2]);
        continue;
      }

      const listMatch = /^\s*-\s*(.*)$/.exec(rawLine);
      if (listKind && listMatch) {
        pushScopeGlob(scope[listKind], listMatch[1]);
        continue;
      }

      if (line.length > 0 && !line.startsWith("#")) {
        hasMalformedLine = true;
      }
    }
  }

  if (!found) {
    return undefined;
  }

  return (scope.allow.length === 0 && scope.forbid.length === 0) || hasMalformedLine
    ? { ...scope, malformed: true }
    : scope;
}

function pushScopeGlob(target: string[], rawGlob: string): void {
  let glob = rawGlob.trim();
  const first = glob[0];
  const last = glob[glob.length - 1];

  if (glob.length >= 2 && ((first === '"' && last === '"') || (first === "'" && last === "'"))) {
    glob = glob.slice(1, -1).trim();
  }

  if (glob.length > 0) {
    target.push(glob);
  }
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function unquoteGitPath(entry: string): string {
  if (!entry.startsWith('"') || !entry.endsWith('"')) {
    return entry;
  }

  const body = entry.slice(1, -1);
  let output = "";
  let bytes: number[] = [];

  const flushBytes = (): boolean => {
    if (bytes.length === 0) {
      return true;
    }

    try {
      output += utf8Decoder.decode(Uint8Array.from(bytes));
      bytes = [];
      return true;
    } catch {
      return false;
    }
  };

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== "\\") {
      if (!flushBytes()) {
        return entry;
      }
      output += ch;
      continue;
    }

    const escaped = body[i + 1];
    if (escaped === undefined) {
      return entry;
    }

    if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      let j = i + 2;
      while (j < body.length && octal.length < 3 && /[0-7]/.test(body[j])) {
        octal += body[j];
        j += 1;
      }

      const byte = Number.parseInt(octal, 8);
      if (byte > 0xff) {
        return entry;
      }

      bytes.push(byte);
      i = j - 1;
      continue;
    }

    if (!flushBytes()) {
      return entry;
    }

    switch (escaped) {
      case "\\":
        output += "\\";
        break;
      case '"':
        output += '"';
        break;
      case "n":
        output += "\n";
        break;
      case "t":
        output += "\t";
        break;
      case "r":
        output += "\r";
        break;
      default:
        output += escaped;
        break;
    }

    i += 1;
  }

  return flushBytes() ? output : entry;
}

export function detectScopeDrift(changedFiles: string[], scope: ScopeDecl): ScopeDriftResult {
  if (scope.malformed === true) {
    return {
      ok: changedFiles.length === 0,
      violations: changedFiles.map((changedFile) => ({
        file: unquoteGitPath(changedFile),
        rule: "scope-unparseable",
      })),
    };
  }

  const forbidMatchers = scope.forbid.map(globToRegex);
  const allowMatchers = scope.allow.map(globToRegex);
  const violations: ScopeViolation[] = [];

  for (const changedFile of changedFiles) {
    const file = unquoteGitPath(changedFile);
    if (forbidMatchers.some((matcher) => matcher.test(file))) {
      violations.push({ file, rule: "forbidden" });
      continue;
    }

    if (allowMatchers.length > 0 && !allowMatchers.some((matcher) => matcher.test(file))) {
      violations.push({ file, rule: "outside-allow" });
    }
  }

  return { ok: violations.length === 0, violations };
}

function globToRegex(glob: string): RegExp {
  let pattern = "";

  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    const next = glob[i + 1];

    if (ch === "*" && next === "*") {
      pattern += ".*";
      i += 1;
      continue;
    }

    if (ch === "*") {
      pattern += "[^/]*";
      continue;
    }

    pattern += escapeRegexChar(ch);
  }

  return new RegExp(`^${pattern}$`);
}

function escapeRegexChar(ch: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(ch) ? `\\${ch}` : ch;
}
