import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface DesignPresetSummary {
  id: string;
  name: string;
  category: string;
  description: string;
  hasZh: boolean;
}

export interface DesignPresetIndex {
  schema: "kunpeng-design-presets/v1";
  source: {
    repo: string;
    commit: string;
    license: string;
  };
  count: number;
  presets: DesignPresetSummary[];
}

export interface DesignPresetManifest {
  schemaVersion: string;
  id: string;
  name: string;
  category: string;
  description: string;
  files: {
    design: string;
    tokens: string;
    designTokens: string;
    tailwind?: string;
    components?: string;
  };
  usage?: string;
  componentsManifest?: string;
  importMode?: string;
}

export interface DesignPresetPackage extends DesignPresetSummary {
  manifest: DesignPresetManifest;
  designMd: string;
  designZhMd?: string;
  tokensCss: string;
  designTokens: unknown;
  componentsHtml?: string;
  /** 品牌主色（从 tokens.css 的 --accent/--primary/--color-primary 提取），供 design-loop 当种子色。 */
  seedHex?: string;
}

/** 从 tokens.css 提取品牌主色：依次试 --accent / --primary / --color-primary 的首个十六进制值。 */
function extractSeedHex(tokensCss: string): string | undefined {
  for (const name of ["accent", "primary", "color-primary"]) {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\b`).exec(tokensCss);
    if (m) return m[1];
  }
  return undefined;
}

export interface DesignPresetLoaderOptions {
  rootDir?: string;
}

export interface LoadDesignPresetOptions extends DesignPresetLoaderOptions {
  preferZh?: boolean;
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function candidateRoots(): string[] {
  return [
    join(MODULE_DIR, "vendor", "design-systems"),
    join(process.cwd(), "src", "design", "vendor", "design-systems"),
    join(process.cwd(), "orchestrator", "src", "design", "vendor", "design-systems"),
  ];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function defaultRootDir(): Promise<string> {
  for (const root of candidateRoots()) {
    if (await exists(join(root, "index.json"))) return root;
  }
  throw new Error("design presets: cannot find vendor/design-systems/index.json");
}

async function rootDir(opts: DesignPresetLoaderOptions = {}): Promise<string> {
  return resolve(opts.rootDir ?? (await defaultRootDir()));
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`design presets: invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`design presets: invalid ${label}`);
  }
  return value;
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`design presets: invalid ${label}`);
  }
  return value;
}

function parseSummary(value: unknown): DesignPresetSummary {
  const item = asRecord(value, "preset summary");
  return {
    id: asString(item.id, "preset id"),
    name: asString(item.name, "preset name"),
    category: asString(item.category, "preset category"),
    description: asString(item.description, "preset description"),
    hasZh: asBoolean(item.hasZh, "preset hasZh"),
  };
}

function parseIndexJson(raw: string): DesignPresetIndex {
  const data = asRecord(JSON.parse(raw), "preset index");
  if (data.schema !== "kunpeng-design-presets/v1") {
    throw new Error("design presets: unsupported index schema");
  }
  const source = asRecord(data.source, "preset index source");
  if (!Array.isArray(data.presets)) {
    throw new Error("design presets: index presets must be an array");
  }
  const presets = data.presets.map(parseSummary);
  const count = typeof data.count === "number" ? data.count : presets.length;
  if (count !== presets.length) {
    throw new Error("design presets: index count does not match presets length");
  }
  return {
    schema: "kunpeng-design-presets/v1",
    source: {
      repo: asString(source.repo, "preset source repo"),
      commit: asString(source.commit, "preset source commit"),
      license: asString(source.license, "preset source license"),
    },
    count,
    presets,
  };
}

function parseManifestJson(raw: string): DesignPresetManifest {
  const data = asRecord(JSON.parse(raw), "preset manifest");
  const files = asRecord(data.files, "preset manifest files");
  return {
    schemaVersion: asString(data.schemaVersion, "manifest schemaVersion"),
    id: asString(data.id, "manifest id"),
    name: asString(data.name, "manifest name"),
    category: asString(data.category, "manifest category"),
    description: asString(data.description, "manifest description"),
    files: {
      design: asString(files.design, "manifest files.design"),
      tokens: asString(files.tokens, "manifest files.tokens"),
      designTokens: asString(files.designTokens, "manifest files.designTokens"),
      ...(typeof files.tailwind === "string" ? { tailwind: files.tailwind } : {}),
      ...(typeof files.components === "string" ? { components: files.components } : {}),
    },
    ...(typeof data.usage === "string" ? { usage: data.usage } : {}),
    ...(typeof data.componentsManifest === "string" ? { componentsManifest: data.componentsManifest } : {}),
    ...(typeof data.importMode === "string" ? { importMode: data.importMode } : {}),
  };
}

function assertSafePresetId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`design presets: invalid preset id "${id}"`);
  }
}

function safeJoin(base: string, relativePath: string): string {
  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes(`${sep}..${sep}`) || normalize(relativePath).startsWith(sep)) {
    throw new Error(`design presets: unsafe preset file path "${relativePath}"`);
  }
  const full = resolve(base, normalized);
  const root = resolve(base);
  if (full !== root && !full.startsWith(`${root}${sep}`)) {
    throw new Error(`design presets: preset file escapes package "${relativePath}"`);
  }
  return full;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

export async function readDesignPresetIndex(opts: DesignPresetLoaderOptions = {}): Promise<DesignPresetIndex> {
  const root = await rootDir(opts);
  return parseIndexJson(await readFile(join(root, "index.json"), "utf8"));
}

export async function listDesignPresets(opts: DesignPresetLoaderOptions = {}): Promise<DesignPresetSummary[]> {
  const index = await readDesignPresetIndex(opts);
  return index.presets.map((preset) => ({ ...preset }));
}

export async function loadDesignPreset(id: string, opts: LoadDesignPresetOptions = {}): Promise<DesignPresetPackage> {
  assertSafePresetId(id);
  const root = await rootDir(opts);
  const index = await readDesignPresetIndex({ rootDir: root });
  const summary = index.presets.find((preset) => preset.id === id);
  if (!summary) {
    throw new Error(`design presets: unknown preset "${id}"`);
  }

  const presetDir = safeJoin(root, id);
  const manifest = parseManifestJson(await readFile(safeJoin(presetDir, "manifest.json"), "utf8"));
  if (manifest.id !== id) {
    throw new Error(`design presets: manifest id "${manifest.id}" does not match "${id}"`);
  }

  const designMd = await readFile(safeJoin(presetDir, manifest.files.design), "utf8");
  const designZhMd = summary.hasZh ? await readOptional(safeJoin(presetDir, "DESIGN-zh.md")) : undefined;
  const selectedDesignMd = opts.preferZh && designZhMd ? designZhMd : designMd;
  const tokensCss = await readFile(safeJoin(presetDir, manifest.files.tokens), "utf8");
  const designTokens = JSON.parse(await readFile(safeJoin(presetDir, manifest.files.designTokens), "utf8")) as unknown;
  const componentsHtml = manifest.files.components ? await readOptional(safeJoin(presetDir, manifest.files.components)) : undefined;

  return {
    ...summary,
    manifest,
    designMd: selectedDesignMd,
    ...(designZhMd ? { designZhMd } : {}),
    tokensCss,
    designTokens,
    ...(componentsHtml ? { componentsHtml } : {}),
    seedHex: extractSeedHex(tokensCss),
  };
}
