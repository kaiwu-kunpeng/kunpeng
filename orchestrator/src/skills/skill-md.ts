export interface SkillFrontmatter {
  name: string;
  description: string;
  triggers?: string[];
  [key: string]: unknown;
}

export interface SkillMdValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

type SkillOrigin = "authored" | "distilled" | "vendored";
type SkillLayer = "base" | "domain" | "meta";

interface FrontmatterSection {
  lines: string[];
  body: string;
}

/**
 * The historical callers expect a frontmatter object without first narrowing
 * it. Keep that source compatibility while returning null at runtime when the
 * document does not contain a strict opening frontmatter block.
 */
export function parseSkillFrontmatter(md: string): SkillFrontmatter {
  const section = frontmatterSection(md);
  if (section === null) {
    // Older callers treated a Markdown body (or an empty file) as metadata-free
    // and compare the result with `{}`. Preserve that established shape while
    // using null for arbitrary non-SKILL.md input, as required by the standard
    // parser contract.
    return (md === "" || /^\s*#(?:\s|$)/.test(md) ? {} : null) as never;
  }

  const parsed: Record<string, unknown> = {};
  let pendingListKey: string | undefined;

  for (let index = 0; index < section.lines.length; index++) {
    const line = section.lines[index];
    const listItem = /^\s*-\s+(.+?)\s*$/.exec(line);
    if (listItem && pendingListKey !== undefined) {
      const current = parsed[pendingListKey];
      const values = Array.isArray(current) ? current : [];
      values.push(unquote(listItem[1]));
      parsed[pendingListKey] = values;
      continue;
    }

    const field = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (!field) {
      pendingListKey = undefined;
      continue;
    }

    const key = field[1];
    const rawValue = field[2] ?? "";
    pendingListKey = undefined;

    if (key === "allow-implicit-invocation") {
      const normalized = rawValue.trim().toLowerCase();
      // 只认 true / false;其它值按缺省处理(不写入该键)。
      if (normalized === "true") parsed[key] = true;
      else if (normalized === "false") parsed[key] = false;
      continue;
    }

    const blockStyle = blockScalarStyle(rawValue);
    if (blockStyle !== undefined) {
      const collected = collectBlockScalar(section.lines, index + 1);
      parsed[key] = formatBlockScalar(collected.lines, blockStyle);
      index = collected.nextIndex - 1;
      continue;
    }

    if (rawValue === "") {
      parsed[key] = null;
      pendingListKey = key;
      continue;
    }

    if (isInlineArray(rawValue)) {
      parsed[key] = parseInlineArray(rawValue);
      continue;
    }

    if (key === "requires-mcp") {
      // 单行逗号写法;下面统一走 normalizeNameList 去重保序。
      parsed[key] = rawValue.split(",");
      continue;
    }

    if (key === "tags" && rawValue.includes(",")) {
      parsed[key] = rawValue.split(",").map(unquote).filter(Boolean);
      continue;
    }

    parsed[key] = unquote(rawValue);
  }

  // requires-mcp 两种写法(YAML 列表 / 逗号单行)统一归一化:trim、去引号、丢空、去重保序。
  const requiresMcp = parsed["requires-mcp"];
  if (Array.isArray(requiresMcp)) {
    parsed["requires-mcp"] = normalizeNameList(requiresMcp);
  }

  return parsed as SkillFrontmatter;
}

function normalizeNameList(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const name = unquote(String(value));
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function validateSkillMd(md: string): SkillMdValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const section = frontmatterSection(md);
  if (section === null) {
    return { ok: false, errors: ["缺少文档开头的 YAML frontmatter"], warnings };
  }

  const fm = parseSkillFrontmatter(md);
  const name: unknown = fm.name;
  if (typeof name !== "string" || name.trim() === "") {
    errors.push("name 必须是非空字符串");
  } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    errors.push("name 必须使用小写 kebab-case");
  }

  const description: unknown = fm.description;
  if (typeof description !== "string" || description.trim() === "") {
    errors.push("description 必须是非空字符串");
  } else if (Array.from(description).length > 1024) {
    errors.push("description 不得超过 1024 字");
  }

  if (!/^#\s+\S.*$/m.test(section.body)) {
    warnings.push("正文建议包含 '# ' 一级标题");
  }

  if (Object.prototype.hasOwnProperty.call(fm, "triggers")) {
    const triggers: unknown = fm.triggers;
    if (!Array.isArray(triggers) || !triggers.every((trigger) => typeof trigger === "string")) {
      errors.push("triggers 必须是字符串数组");
    }
  }

  for (const key of ["model", "sandbox", "mcp", "mcp-servers", "mcpServers"]) {
    if (Object.prototype.hasOwnProperty.call(fm, key)) {
      errors.push(`frontmatter 不得携带 ${key}：模型/沙箱/MCP 配置属受保护路径，不允许放在 SKILL.md 头部`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function matchesTriggers(fm: SkillFrontmatter, text: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(fm, "triggers")) return true;
  const triggers: unknown = fm.triggers;
  if (!Array.isArray(triggers) || !triggers.every((trigger) => typeof trigger === "string")) return false;

  const haystack = text.toLowerCase();
  return triggers.some((trigger) => haystack.includes(trigger.toLowerCase()));
}

export function skillEntryFromDir(
  dir: string,
  md: string,
  origin: SkillOrigin,
  idFallback: string,
): {
  id: string;
  name: string;
  description: string;
  origin: SkillOrigin;
  tags?: string[];
  triggers?: string[];
  layer?: SkillLayer;
  implicitInvocation?: boolean;
  requiresMcp?: string[];
  dir: string;
} {
  const fm = parseSkillFrontmatter(md);
  const entry: {
    id: string;
    name: string;
    description: string;
    origin: SkillOrigin;
    tags?: string[];
    triggers?: string[];
    layer?: SkillLayer;
    implicitInvocation?: boolean;
    requiresMcp?: string[];
    dir: string;
  } = {
    id: idFallback,
    name: typeof fm?.name === "string" && fm.name !== "" ? fm.name : idFallback,
    description: typeof fm?.description === "string" ? fm.description : "",
    origin,
    dir,
  };

  if (isStringArray(fm?.tags)) entry.tags = fm.tags;
  if (isStringArray(fm?.triggers)) entry.triggers = fm.triggers;
  if (isSkillLayer(fm?.layer)) entry.layer = fm.layer;
  // 只在显式声明「不允许隐式调用」时落字段;true/缺省/不合法一律 undefined,避免改脏历史存档。
  if (fm?.["allow-implicit-invocation"] === false) entry.implicitInvocation = false;
  const requiresMcp = fm?.["requires-mcp"];
  if (isStringArray(requiresMcp) && requiresMcp.length > 0) entry.requiresMcp = requiresMcp;

  return entry;
}

function frontmatterSection(md: string): FrontmatterSection | null {
  if (!md.startsWith("---\n") && !md.startsWith("---\r\n")) return null;

  const lines = md.split(/\r?\n/);
  let end = -1;
  for (let index = 1; index < lines.length; index++) {
    if (lines[index] === "---") {
      end = index;
      break;
    }
  }
  if (end < 0) return null;

  return {
    lines: lines.slice(1, end),
    body: lines.slice(end + 1).join("\n"),
  };
}

function isInlineArray(raw: string): boolean {
  const value = raw.trim();
  return value.startsWith("[") && value.endsWith("]");
}

function parseInlineArray(raw: string): string[] {
  const body = raw.trim().slice(1, -1).trim();
  if (body === "") return [];
  return body.split(",").map(unquote);
}

type BlockScalarStyle = "|" | "|-" | ">" | ">-";

function blockScalarStyle(raw: string): BlockScalarStyle | undefined {
  const value = raw.trim();
  if (value === "|" || value === "|-" || value === ">" || value === ">-") return value;
  return undefined;
}

function collectBlockScalar(
  lines: string[],
  startIndex: number,
): { lines: string[]; nextIndex: number } {
  const collected: string[] = [];
  let index = startIndex;
  for (; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === "") {
      collected.push("");
      continue;
    }
    if (!/^\s+/.test(line)) break;
    collected.push(line);
  }

  const contentIndent = collected
    .filter((line) => line.trim() !== "")
    .reduce((minimum, line) => Math.min(minimum, line.length - line.trimStart().length), Number.POSITIVE_INFINITY);
  const normalized = Number.isFinite(contentIndent)
    ? collected.map((line) => line === "" ? "" : line.slice(contentIndent))
    : [];
  return { lines: normalized, nextIndex: index };
}

function formatBlockScalar(lines: string[], style: BlockScalarStyle): string {
  const contentLines = [...lines];
  while (contentLines.at(-1) === "") contentLines.pop();
  if (contentLines.length === 0) return "";
  const value = style.startsWith("|") ? contentLines.join("\n") : contentLines.join(" ");
  return style.endsWith("-") ? value : `${value}\n`;
}

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSkillLayer(layer: unknown): layer is SkillLayer {
  return layer === "base" || layer === "domain" || layer === "meta";
}
