import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const CHROME_CANDIDATES: string[] = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

export function findChrome(
  candidates: string[] = CHROME_CANDIDATES,
  envPath = process.env.CHROME_PATH,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  if (envPath && exists(envPath)) {
    return envPath;
  }

  return candidates.find((candidate) => exists(candidate));
}

export function chromeShotArgs(url: string, out: string, width = 1280, height = 900): string[] {
  return [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    `--screenshot=${out}`,
    `--window-size=${width},${height}`,
    url,
  ];
}

export interface ShotOpts {
  url: string;
  out: string;
  width?: number;
  height?: number;
  timeoutMs?: number;
}

export async function captureScreenshot(opts: ShotOpts, chromePath?: string): Promise<boolean> {
  const resolvedChromePath = arguments.length >= 2 ? chromePath : findChrome();
  if (!resolvedChromePath) {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const child = spawn(resolvedChromePath, chromeShotArgs(opts.url, opts.out, opts.width, opts.height), {
      stdio: "ignore",
    });

    const finish = (ok: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, opts.timeoutMs ?? 30000);

    child.on("error", () => {
      finish(false);
    });

    child.on("exit", (code) => {
      finish(code === 0 && existsSync(opts.out));
    });
  });
}
