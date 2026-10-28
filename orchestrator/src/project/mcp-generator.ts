import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ActiveProfile } from "./profile.js";
import { DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS, type ManagedCredentialEnvKey } from "./profile-env-builder.js";

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

export interface ProfileMcpConfigOptions {
  managedKeys?: readonly ManagedCredentialEnvKey[];
}

function cloneServer(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    args: server.args ? [...server.args] : undefined,
    env: server.env ? { ...server.env } : undefined,
    headers: server.headers ? { ...server.headers } : undefined,
  };
}

export function buildProfileMcpConfig(profile: ActiveProfile, baseConfig: McpConfig, opts: ProfileMcpConfigOptions = {}): McpConfig {
  const managedKeys = opts.managedKeys ?? DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS;
  const mcpServers = Object.fromEntries(
    Object.entries(baseConfig.mcpServers).map(([name, server]) => {
      const next = cloneServer(server);
      if (next.env) {
        for (const key of managedKeys) {
          if (Object.prototype.hasOwnProperty.call(next.env, key)) {
            next.env[key] = profile.credentialsEnv[key] ?? "";
          }
        }
      }
      return [name, next];
    }),
  );

  return { ...baseConfig, mcpServers };
}

export async function writeProfileMcpConfig(
  profile: ActiveProfile,
  baseConfig: McpConfig,
  opts: ProfileMcpConfigOptions = {},
): Promise<string> {
  const config = buildProfileMcpConfig(profile, baseConfig, opts);
  await mkdir(dirname(profile.mcpConfigPath), { recursive: true });
  await writeFile(profile.mcpConfigPath, `${JSON.stringify(config, null, 2)}\n`);
  return profile.mcpConfigPath;
}
