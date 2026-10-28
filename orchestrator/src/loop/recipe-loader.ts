import { access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { errorMessage } from "../util/errors.js";

export interface ExternalRecipeLoadResult {
  loaded: string[];
  failed: { path: string; error: string }[];
}

function isMissingPath(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

export async function loadExternalRecipes(dirs: string[]): Promise<ExternalRecipeLoadResult> {
  const loaded: string[] = [];
  const failed: ExternalRecipeLoadResult["failed"] = [];

  for (const dir of dirs) {
    const absoluteDir = resolve(dir);
    let entries;
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch (error) {
      if (isMissingPath(error)) continue;
      failed.push({ path: absoluteDir, error: errorMessage(error) });
      continue;
    }

    const recipeDirs = entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const recipeDir of recipeDirs) {
      const modulePath = join(absoluteDir, recipeDir.name, "index.js");
      try {
        await access(modulePath);
      } catch (error) {
        if (!isMissingPath(error)) {
          failed.push({ path: modulePath, error: errorMessage(error) });
        }
        continue;
      }

      try {
        await import(modulePath);
        loaded.push(modulePath);
      } catch (error) {
        failed.push({ path: modulePath, error: errorMessage(error) });
      }
    }
  }

  return { loaded, failed };
}
