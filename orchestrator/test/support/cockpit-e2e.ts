import { mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startDashboard } from "../../src/server/http.js";
import { buildAuthConfig, writeAuthConfig } from "../../src/server/auth.js";

export interface CockpitHarness {
  baseUrl: string;
  port: number;
  stateDir: string;
}

export interface CockpitHarnessOptions {
  auth?: {
    username: string;
    password: string;
  };
  /** 预置 stateDir(测试可先在 {stateDir}/chat/<user>/ 播种会话)。提供时由调用方负责清理,不自动删。 */
  stateDir?: string;
}

export async function withCockpit<T>(
  repoRoot: string,
  run: (harness: CockpitHarness) => Promise<T>,
  opts: CockpitHarnessOptions = {},
): Promise<T> {
  const ownsStateDir = !opts.stateDir;
  const stateDir = opts.stateDir ?? (await mkdtemp(join(tmpdir(), "kp-cockpit-e2e-")));
  if (opts.auth) {
    await writeAuthConfig(stateDir, buildAuthConfig(opts.auth.username, opts.auth.password, {
      salt: randomBytes(16).toString("hex"),
      secret: randomBytes(32).toString("hex"),
      now: Date.now(),
    }));
  }
  const server = await startDashboard({ port: 0, repoRoot, stateDir });
  try {
    return await run({
      baseUrl: `http://127.0.0.1:${server.port}`,
      port: server.port,
      stateDir,
    });
  } finally {
    server.close();
    if (ownsStateDir) await rm(stateDir, { recursive: true, force: true });
  }
}

export async function withBrowserPage<T>(
  baseUrl: string,
  route: string,
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const browser: Browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(new URL(route, baseUrl).toString());
    return await run(page);
  } finally {
    await browser.close();
  }
}
