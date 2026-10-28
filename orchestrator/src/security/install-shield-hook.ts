import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderPromptShieldModule } from "./prompt-shield.js";

export async function installShieldHook(destDir: string): Promise<string> {
  const absoluteDest = resolve(destDir);
  await mkdir(absoluteDest, { recursive: true });
  const artifactPath = join(absoluteDest, "prompt-shield.mjs");
  await writeFile(artifactPath, renderPromptShieldModule(), "utf8");
  return artifactPath;
}
