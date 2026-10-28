import { isRecord } from "../util/is-record.js";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { kunpengStateDir } from "../project/state-dir.js";
import { isNodeError } from "../util/errors.js";

/** upgrade / rollback 换版时留下的上一版本快照（P1-7c）；rollback 用它换回，再把被换下的记成 previous，可来回。 */
export interface PluginPrevious {
  version: string;
  dir: string;
  skills?: string[];
  mcpIds?: string[];
  replacedAt: string;
}

export interface PluginRecord {
  name: string;
  version: string;
  dir: string;
  enabled: boolean;
  addedAt?: string;
  skills?: string[];
  mcpIds?: string[];
  previous?: PluginPrevious;
}

interface PluginIndex {
  plugins: PluginRecord[];
}

let temporaryFileSequence = 0;

export function pluginsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(kunpengStateDir(env), "plugins");
}

export async function listPlugins(root: string): Promise<PluginRecord[]> {
  return readIndex(root);
}

export async function upsertPlugin(root: string, record: PluginRecord): Promise<void> {
  validateName(record.name);

  const plugins = await readIndex(root);
  const existingIndex = plugins.findIndex((plugin) => plugin.name === record.name);
  if (existingIndex >= 0) {
    plugins[existingIndex] = record;
  } else {
    plugins.push(record);
  }
  await writeIndex(root, plugins);
}

export async function setPluginEnabled(
  root: string,
  name: string,
  enabled: boolean,
  components?: { skills?: string[]; mcpIds?: string[] },
): Promise<PluginRecord> {
  const plugins = await readIndex(root);
  const index = plugins.findIndex((plugin) => plugin.name === name);
  const plugin = plugins[index];
  if (index < 0 || plugin === undefined) {
    throw new Error(`未找到插件: ${name}`);
  }

  const updated: PluginRecord = { ...plugin, enabled, ...components };
  plugins[index] = updated;
  await writeIndex(root, plugins);
  return updated;
}

export async function removePlugin(root: string, name: string): Promise<PluginRecord> {
  const plugins = await readIndex(root);
  const index = plugins.findIndex((plugin) => plugin.name === name);
  const removed = plugins[index];
  if (index < 0 || removed === undefined) {
    throw new Error(`未找到插件: ${name}`);
  }

  plugins.splice(index, 1);
  await writeIndex(root, plugins);
  return removed;
}

async function readIndex(root: string): Promise<PluginRecord[]> {
  const path = join(root, "index.json");
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const parsed: unknown = JSON.parse(contents);
  if (!isRecord(parsed) || !Array.isArray(parsed.plugins)) {
    throw new TypeError(`插件索引必须包含 plugins 数组: ${path}`);
  }
  return parsed.plugins as PluginRecord[];
}

async function writeIndex(root: string, plugins: PluginRecord[]): Promise<void> {
  await mkdir(root, { recursive: true });
  const path = join(root, "index.json");
  temporaryFileSequence += 1;
  const temporaryPath = `${path}.tmp-${process.pid}-${temporaryFileSequence}`;
  const index: PluginIndex = { plugins };

  try {
    await writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function validateName(name: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(`非法插件 name: ${name}`);
  }
}
