export type SemverKind = "major" | "minor" | "patch";

/** SemVer bump. current may have prefix/suffix; only the first three numeric segments are used. */
export function bumpSemver(current: string, kind: SemverKind): string {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(current.trim());
  if (!m) throw new Error(`非法 semver: ${current}`);
  let maj = Number(m[1]);
  let min = Number(m[2]);
  let pat = Number(m[3]);
  if (kind === "major") {
    maj += 1;
    min = 0;
    pat = 0;
  } else if (kind === "minor") {
    min += 1;
    pat = 0;
  } else {
    pat += 1;
  }
  return `${maj}.${min}.${pat}`;
}

/** Roll CHANGELOG Unreleased content into a dated version section while keeping Unreleased empty. */
export function rollUnreleased(changelog: string, version: string, dateISO: string): string {
  const header = "## [Unreleased]";
  const idx = changelog.indexOf(header);
  if (idx < 0) {
    return `${changelog.trimEnd()}\n\n## [${version}] - ${dateISO}\n`;
  }
  const afterHeader = idx + header.length;
  const nextSection = changelog.indexOf("\n## ", afterHeader);
  const end = nextSection < 0 ? changelog.length : nextSection;
  const unrelBody = changelog.slice(afterHeader, end).trim();
  const before = changelog.slice(0, afterHeader);
  const after = changelog.slice(end);
  const versionBlock = unrelBody
    ? `\n\n## [${version}] - ${dateISO}\n\n${unrelBody}\n`
    : `\n\n## [${version}] - ${dateISO}\n`;
  return `${before}\n${versionBlock}${after}`;
}

/** Read version field from package.json text without requiring full JSON parsing. */
export function readVersionField(pkgJson: string): string {
  const m = /"version"\s*:\s*"([^"]+)"/.exec(pkgJson);
  if (!m) throw new Error("package.json 无 version 字段");
  return m[1];
}

/** Replace only the first version field in package.json text. */
export function writeVersionField(pkgJson: string, version: string): string {
  return pkgJson.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
}
