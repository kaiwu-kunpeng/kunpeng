import { readFileSync as defaultReadFileSync } from "node:fs";
import { join } from "node:path";
import { kunpengStateDir } from "./state-dir.js";

export { kunpengStateDir } from "./state-dir.js";

export interface ActiveProfile {
  id: string;
  projectsPath: string;
  credentialsPath: string;
  credentialsEnv: Record<string, string>;
  mcpConfigPath: string;
}

export function profilesDir(): string {
  return join(kunpengStateDir(), "profiles");
}

export function profileDir(id: string): string {
  return join(profilesDir(), id);
}

export function sharedDir(): string {
  return join(kunpengStateDir(), "shared");
}

export function parseDotenv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex < 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  }
  return env;
}

export function resolveActiveProfile(
  id: string,
  readFileSync: (p: string) => string = (p) => defaultReadFileSync(p, "utf8"),
): ActiveProfile {
  const cleanId = id.trim();
  if (!cleanId) throw new Error("profile id is required");

  const dir = profileDir(cleanId);
  const credentialsPath = join(dir, "credentials.env");
  const credentialsEnv = (() => {
    try {
      return parseDotenv(readFileSync(credentialsPath));
    } catch {
      return {};
    }
  })();

  return {
    id: cleanId,
    projectsPath: join(dir, "projects.json"),
    credentialsPath,
    credentialsEnv,
    mcpConfigPath: join(dir, "mcp.json"),
  };
}
