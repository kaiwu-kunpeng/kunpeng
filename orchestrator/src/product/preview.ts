import { createWriteStream, type Dirent } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { productLoopDir } from "./loop-store.js";

export interface PreviewInfo {
  pid: number;
  port: number;
  url: string;
  script: string;
  startedAt: number;
}

export function resolvePreviewCommand(pkg: { scripts?: Record<string, string> }): { script: string } | undefined {
  if (pkg.scripts?.dev) return { script: "dev" };
  if (pkg.scripts?.start) return { script: "start" };
  return undefined;
}

async function readPackageJson(repoRoot: string): Promise<{ scripts?: Record<string, string> }> {
  return JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> };
}

function previewInfoPath(repoRoot: string, slug: string): string {
  return join(productLoopDir(repoRoot, slug), "preview.json");
}

function isPreviewInfo(value: unknown): value is PreviewInfo {
  if (typeof value !== "object" || value === null) return false;
  const info = value as Partial<PreviewInfo>;
  return typeof info.pid === "number"
    && Number.isInteger(info.pid)
    && info.pid > 0
    && Number.isFinite(info.port)
    && typeof info.url === "string"
    && typeof info.script === "string"
    && Number.isFinite(info.startedAt);
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(1_000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid);
  } catch {
    try {
      process.kill(pid);
    } catch {
      /* 进程已退出，忽略 */
    }
  }
}

export async function startPreview(
  repoRoot: string,
  slug: string,
  opts: { port: number; script?: string; now?: number; cwd?: string },
): Promise<PreviewInfo> {
  const base = opts.cwd ?? repoRoot;
  const pkg = await readPackageJson(base);
  const script = opts.script ?? resolvePreviewCommand(pkg)?.script;
  if (!script) throw new Error("未找到可用的 dev/start 脚本");

  const loopDir = productLoopDir(repoRoot, slug);
  await mkdir(loopDir, { recursive: true });
  const logStream = createWriteStream(join(loopDir, "preview.log"), { flags: "a" });
  const child = spawn("npm", ["run", script], {
    cwd: base,
    detached: true,
    env: { ...process.env, PORT: String(opts.port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!child.pid) {
    logStream.end();
    throw new Error("预览进程启动失败");
  }
  child.stdout?.pipe(logStream, { end: false });
  child.stderr?.pipe(logStream, { end: false });
  child.once("exit", () => logStream.end());

  const ready = await waitForPort(opts.port, 20_000);
  if (!ready) {
    killProcessGroup(child.pid);
    throw new Error(`预览服务 ${script} 在端口 ${opts.port} 启动超时`);
  }

  const info: PreviewInfo = {
    pid: child.pid,
    port: opts.port,
    url: `http://localhost:${opts.port}`,
    script,
    startedAt: opts.now ?? Date.now(),
  };
  await writeFile(previewInfoPath(repoRoot, slug), `${JSON.stringify(info, null, 2)}\n`, "utf8");
  return info;
}

export async function readPreview(repoRoot: string, slug: string): Promise<(PreviewInfo & { alive: boolean }) | undefined> {
  let info: PreviewInfo;
  try {
    info = JSON.parse(await readFile(previewInfoPath(repoRoot, slug), "utf8")) as PreviewInfo;
  } catch {
    return undefined;
  }
  let alive: boolean;
  try {
    process.kill(info.pid, 0);
    alive = true;
  } catch {
    alive = false;
  }
  return { ...info, alive };
}

export async function sweepStalePreviews(
  repoRoot: string,
  opts?: { now?: number; maxAgeMs?: number; kill?: (pid: number) => void },
): Promise<string[]> {
  const now = opts?.now ?? Date.now();
  const maxAgeMs = opts?.maxAgeMs ?? 14_400_000;
  const kill = opts?.kill ?? killProcessGroup;
  const productDir = join(repoRoot, ".kunpeng", "product");
  let entries: Dirent[];
  try {
    entries = await readdir(productDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const swept: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const path = previewInfoPath(repoRoot, slug);
    try {
      const info = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (!isPreviewInfo(info)) continue;
      if (now - info.startedAt <= maxAgeMs) continue;

      let alive = false;
      try {
        process.kill(info.pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
      if (alive) kill(info.pid);

      await rm(path, { force: true });
      swept.push(slug);
    } catch {
      continue;
    }
  }
  return swept;
}

export async function stopPreview(repoRoot: string, slug: string): Promise<boolean> {
  const info = await readPreview(repoRoot, slug);
  if (!info) return false;
  killProcessGroup(info.pid);
  await rm(previewInfoPath(repoRoot, slug), { force: true });
  return true;
}
