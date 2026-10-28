import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { sharedDir } from "../project/profile.js";
import { kunpengStateDir } from "../project/registry.js";

const capturesDirCache = new Map<string, string>();
const legacyCapturesDirAliases = new Map<string, string>();

function sha1Prefix(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function captureKey(repoRoot: string): string {
  let remoteUrl = "";
  try {
    remoteUrl = execFileSync("git", ["-C", repoRoot, "config", "--get", "remote.origin.url"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
  } catch {
    // 没有 remote 时按绝对路径隔离。
  }

  const identity = remoteUrl || repoRoot;
  const name = remoteUrl
    ? basename(remoteUrl.replace(/\.git$/, ""))
    : basename(repoRoot);
  return `${name}-${sha1Prefix(identity)}`.replace(/[^A-Za-z0-9._-]/g, "-");
}

function migrateLegacyCaptures(repoRoot: string, capturesDir: string): void {
  try {
    if (readdirSync(capturesDir).some((name) => name.endsWith(".json"))) return;
    const legacyDir = join(repoRoot, ".kunpeng", "captures");
    if (!existsSync(legacyDir)) return;
    const legacyNames = readdirSync(legacyDir);
    const legacyJson = legacyNames.filter((name) => name.endsWith(".json"));
    for (const name of legacyJson) {
      try {
        const target = join(capturesDir, name);
        if (!existsSync(target)) copyFileSync(join(legacyDir, name), target);
      } catch {
        // 单文件搬迁 best-effort；坏文件不阻塞其余 captures。
      }
    }
    if (legacyNames.length > 0 && legacyJson.length === 0) {
      try {
        writeFileSync(join(capturesDir, ".legacy-captures-present"), "", { flag: "wx" });
      } catch {
        // 仅用于保留旧非 JSON captures 的活动信号，不影响中央知识库。
      }
    }
  } catch {
    // 旧目录不可读等搬迁失败不影响中央目录使用。
  }
}

function linkLegacyCapturesDir(repoRoot: string, capturesDir: string): void {
  const legacyDir = join(repoRoot, ".kunpeng", "captures");
  try {
    if (existsSync(legacyDir)) return;
    mkdirSync(join(repoRoot, ".kunpeng"), { recursive: true });
    symlinkSync(capturesDir, legacyDir, "dir");
  } catch {
    // 兼容旧调用方的只读路径；失败时中央目录仍可正常工作。
  }
}

export function resolveCapturesDir(repoRoot: string): string {
  const resolvedRepoRoot = resolve(repoRoot);
  const cached = capturesDirCache.get(resolvedRepoRoot);
  if (cached !== undefined) return cached;

  const configuredRoot = process.env.KUNPENG_CAPTURES_ROOT?.trim();
  const root = configuredRoot || join(kunpengStateDir(), "captures");
  const capturesDir = join(root, captureKey(resolvedRepoRoot));
  mkdirSync(capturesDir, { recursive: true });
  migrateLegacyCaptures(resolvedRepoRoot, capturesDir);
  linkLegacyCapturesDir(resolvedRepoRoot, capturesDir);
  legacyCapturesDirAliases.set(join(resolvedRepoRoot, ".kunpeng", "captures"), capturesDir);
  capturesDirCache.set(resolvedRepoRoot, capturesDir);
  return capturesDir;
}

export type CaptureSource = "url" | "text" | "file" | "chat" | "alert" | "competitor";

export interface Capture {
  id: string;
  source: CaptureSource;
  kind: string;
  raw: string;
  title?: string;
  summary?: string;
  tags: string[];
  category?: string;
  distill?: string;
  distillLevel?: number;
  projectId?: string;
  sourceProfileId?: string;
  citedFrom?: string;
  createdAt: number;
  promoted: boolean;
}

export interface NewCaptureInput {
  source: CaptureSource;
  kind: string;
  raw: string;
  title?: string;
  summary?: string;
  tags?: string[];
  category?: string;
  projectId?: string;
  citedFrom?: string;
}

export type CaptureDeps = { now: () => number; id: () => string };

export function newCapture(input: NewCaptureInput, deps: CaptureDeps): Capture {
  return {
    id: deps.id(),
    source: input.source,
    kind: input.kind,
    raw: input.raw,
    title: input.title,
    summary: input.summary,
    tags: input.tags ?? [],
    category: input.category,
    projectId: input.projectId,
    createdAt: deps.now(),
    citedFrom: input.citedFrom,
    promoted: false,
  };
}

export type CapturePatch = Partial<
  Pick<Capture, "title" | "summary" | "tags" | "category" | "distill" | "distillLevel">
>;

export type FileSystem = Pick<typeof fs, "access" | "mkdir" | "readFile" | "readdir" | "writeFile" | "unlink">;

function isErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

const CONTENT_INDEX_FILE = "content-index.json";
const CONTENT_DEDUP_MIN_LENGTH = 120;

function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function contentKey(capture: Capture): string {
  return createHash("sha256")
    .update(`${capture.kind}\n${normalize(capture.raw)}`)
    .digest("hex");
}

export class CaptureStore {
  private dir: string;

  constructor(
    dir: string,
    private io: FileSystem = fs,
    private mirrorDir: string | null = join(sharedDir(), "knowledge"),
  ) {
    this.dir = legacyCapturesDirAliases.get(resolve(dir)) ?? dir;
  }

  private pathIn(dir: string, id: string): string {
    return join(dir, `${encodeURIComponent(id)}.json`);
  }

  private path(id: string): string {
    return this.pathIn(this.dir, id);
  }

  private contentIndexPath(): string {
    return join(this.dir, CONTENT_INDEX_FILE);
  }

  private async readContentIndex(): Promise<Record<string, string>> {
    try {
      const parsed: unknown = JSON.parse(await this.io.readFile(this.contentIndexPath(), "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    } catch {
      return {};
    }
  }

  private async writeContentIndexBestEffort(index: Record<string, string>): Promise<void> {
    try {
      await this.io.writeFile(this.contentIndexPath(), `${JSON.stringify(index, null, 2)}\n`, {
        encoding: "utf8",
        flag: "w",
      });
    } catch {
      // best-effort only: capture persistence remains the source of truth.
    }
  }

  private async releaseContentIndexForIdBestEffort(id: string): Promise<void> {
    const index = await this.readContentIndex();
    const next = Object.fromEntries(Object.entries(index).filter(([, indexedId]) => indexedId !== id));
    if (Object.keys(next).length === Object.keys(index).length) return;
    await this.writeContentIndexBestEffort(next);
  }

  async appendCapture(capture: Capture): Promise<boolean> {
    const normalizedRaw = normalize(capture.raw);
    const shouldDeduplicate = normalizedRaw.length >= CONTENT_DEDUP_MIN_LENGTH;
    let index: Record<string, string> = {};
    let key: string | null = null;
    if (shouldDeduplicate) {
      index = await this.readContentIndex();
      key = contentKey(capture);
      if (index[key] !== undefined) return false;
    }

    const serialized = `${JSON.stringify(capture, null, 2)}\n`;
    await this.io.mkdir(this.dir, { recursive: true });
    try {
      await this.io.writeFile(this.path(capture.id), serialized, {
        encoding: "utf8",
        flag: "wx",
      });
      if (this.mirrorDir !== null) {
        await this.io.mkdir(this.mirrorDir, { recursive: true });
        await this.io.writeFile(this.pathIn(this.mirrorDir, capture.id), serialized, {
          encoding: "utf8",
          flag: "w",
        });
      }
      if (key !== null) {
        await this.writeContentIndexBestEffort({ ...index, [key]: capture.id });
      }
      return true;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
        return false;
      }
      throw error;
    }
  }

  async listCaptures(): Promise<Capture[]> {
    const files = (await this.io.readdir(this.dir).catch(() => [] as string[]))
      .filter((file) => file.endsWith(".json") && file !== CONTENT_INDEX_FILE)
      .sort();
    const parsed = await Promise.all(files.map(async (file) => {
      try {
        return JSON.parse(await this.io.readFile(join(this.dir, file), "utf8")) as Capture;
      } catch {
        console.warn(`[capture-store] 跳过无法解析的文件: ${file}`);
        return null;
      }
    }));
    return parsed.filter((capture): capture is Capture => capture !== null);
  }

  async promoteCapture(id: string): Promise<Capture | null> {
    const raw = await this.io.readFile(this.path(id), "utf8").catch(() => null);
    if (raw === null) return null;

    const cur = JSON.parse(raw) as Capture;
    if (cur.promoted === true) return cur;

    const next: Capture = { ...cur, promoted: true };
    await this.io.writeFile(this.path(id), `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      flag: "w",
    });
    return next;
  }

  async distillCapture(id: string, distill: string, distillLevel: number): Promise<Capture | null> {
    const raw = await this.io.readFile(this.path(id), "utf8").catch(() => null);
    if (raw === null) return null;

    const cur = JSON.parse(raw) as Capture;
    const next: Capture = { ...cur, distill, distillLevel };
    await this.io.writeFile(this.path(id), `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      flag: "w",
    });
    return next;
  }

  async editCapture(id: string, patch: CapturePatch): Promise<Capture | null> {
    let raw: string;
    try {
      raw = await this.io.readFile(this.path(id), "utf8");
    } catch (error) {
      if (isErrorWithCode(error, "ENOENT")) return null;
      throw error;
    }

    const next: Capture = { ...(JSON.parse(raw) as Capture) };
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.summary !== undefined) next.summary = patch.summary;
    if (patch.tags !== undefined) next.tags = patch.tags;
    if (patch.category !== undefined) next.category = patch.category;
    if (patch.distill !== undefined) next.distill = patch.distill;
    if (patch.distillLevel !== undefined) next.distillLevel = patch.distillLevel;

    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    await this.io.writeFile(this.path(id), serialized, {
      encoding: "utf8",
      flag: "w",
    });
    if (this.mirrorDir !== null) {
      await this.io.mkdir(this.mirrorDir, { recursive: true });
      await this.io.writeFile(this.pathIn(this.mirrorDir, id), serialized, {
        encoding: "utf8",
        flag: "w",
      });
    }
    return next;
  }

  async deleteCapture(id: string): Promise<boolean> {
    try {
      await this.io.unlink(this.path(id));
    } catch (error) {
      if (isErrorWithCode(error, "ENOENT")) return false;
      throw error;
    }

    if (this.mirrorDir !== null) {
      try {
        await this.io.unlink(this.pathIn(this.mirrorDir, id));
      } catch (error) {
        if (!isErrorWithCode(error, "ENOENT")) throw error;
      }
    }
    await this.releaseContentIndexForIdBestEffort(id);
    return true;
  }
}
