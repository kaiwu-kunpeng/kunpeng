import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { buildCrossFileEdges } from "./cross-file.js";
import { parseSource } from "./parser.js";
import { CodeGraphStore } from "./store.js";

const DEFAULT_EXTS = [".ts", ".js"];
const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist"]);

export function buildGraphFromDir(
  rootDir: string,
  opts?: { exts?: string[] },
): CodeGraphStore {
  const store = new CodeGraphStore();
  const exts = new Set(opts?.exts ?? DEFAULT_EXTS);
  const files: { path: string; source: string }[] = [];

  walk(rootDir, rootDir, exts, (absolutePath, relativePath) => {
    files.push({ path: relativePath, source: readFileSync(absolutePath, "utf8") });
  });

  for (const file of files) {
    const parsed = parseSource(file.path, file.source);

    store.addNode({
      id: file.path,
      kind: "file",
      name: file.path,
      file: file.path,
      line: 1,
    });

    for (const node of parsed.nodes) {
      store.addNode(node);
    }

    for (const edge of parsed.edges) {
      store.addEdge(edge);
    }
  }

  for (const edge of buildCrossFileEdges(files)) {
    store.addEdge(edge);
  }

  return store;
}

export function collectSourceMtimes(rootDir: string): Record<string, number> {
  const mtimes: Record<string, number> = {};
  const exts = new Set(DEFAULT_EXTS);

  walk(rootDir, rootDir, exts, (absolutePath, relativePath) => {
    mtimes[relativePath] = statSync(absolutePath).mtimeMs;
  });

  return mtimes;
}

function walk(
  rootDir: string,
  dir: string,
  exts: Set<string>,
  visit: (absolutePath: string, relativePath: string) => void,
): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) {
        walk(rootDir, absolutePath, exts, visit);
      }
      continue;
    }

    if (!entry.isFile() || entry.name.endsWith(".d.ts") || !exts.has(extname(entry.name))) {
      continue;
    }

    const relativePath = toPosixPath(relative(rootDir, absolutePath));
    visit(absolutePath, relativePath);
  }
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}
