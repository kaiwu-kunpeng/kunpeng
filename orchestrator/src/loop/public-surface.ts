function globToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index++;
      }
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    source += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }

  return new RegExp(source + "$");
}

export function matchesPublicSurface(
  changedFiles: readonly string[],
  patterns: readonly string[],
): string[] {
  if (patterns.length === 0) return [];

  const matchers = patterns.map(globToRegExp);
  const matched = new Set<string>();
  for (const file of changedFiles) {
    if (matchers.some((matcher) => matcher.test(file))) matched.add(file);
  }
  return [...matched];
}
