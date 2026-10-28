import type { ActiveProfile } from "./profile.js";

export const DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "VERCEL_TOKEN",
  "NEON_DATABASE_URL",
  "DATABASE_URL",
  "SUPABASE_ACCESS_TOKEN",
] as const;

export type ManagedCredentialEnvKey = (typeof DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS)[number] | (string & {});

export const FLOW_ENV_BASE_KEYS = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ",
  "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "no_proxy", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR",
] as const;

export const FLOW_ENV_ALLOWED_PREFIXES = ["KUNPENG_", "KP_"] as const;

export type FlowEnvMode = "allowlist" | "inherit";

export function resolveFlowEnvMode(env: NodeJS.ProcessEnv): FlowEnvMode {
  return env.KUNPENG_FLOW_ENV_MODE?.trim().toLowerCase() === "inherit" ? "inherit" : "allowlist";
}

export function flowEnvExtraAllowKeys(env: NodeJS.ProcessEnv): string[] {
  return (env.KUNPENG_FLOW_ENV_ALLOW ?? "").split(",").map((key) => key.trim()).filter(Boolean);
}

export function isFlowEnvKeyAllowed(key: string, allowKeys: readonly string[]): boolean {
  return FLOW_ENV_BASE_KEYS.some((baseKey) => baseKey === key)
    || FLOW_ENV_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))
    || allowKeys.includes(key);
}

export interface ProfileEnvBuildOptions {
  baseEnv?: NodeJS.ProcessEnv;
  managedKeys?: readonly ManagedCredentialEnvKey[];
  allowKeys?: readonly string[];
  mode?: FlowEnvMode;
}

export function buildFlowEnv(opts: {
  baseEnv: NodeJS.ProcessEnv;
  allowKeys?: readonly string[];
  profile?: ActiveProfile;
  managedKeys?: readonly ManagedCredentialEnvKey[];
  mode?: FlowEnvMode;
}): Record<string, string> {
  const { baseEnv, profile } = opts;
  const mode = opts.mode ?? resolveFlowEnvMode(baseEnv);
  const allowKeys = [...(opts.allowKeys ?? []), ...flowEnvExtraAllowKeys(baseEnv)];
  const managedKeys = opts.managedKeys ?? DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS;
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (mode === "allowlist" && (managedKeys.includes(key) || !isFlowEnvKeyAllowed(key, allowKeys))) continue;
    if (value !== undefined) env[key] = value;
  }

  if (profile) {
    for (const key of managedKeys) {
      env[key] = profile.credentialsEnv[key] ?? "";
    }
  }

  return env;
}

export function buildProfileEnv(
  profile: ActiveProfile,
  opts: ProfileEnvBuildOptions = {},
): Record<string, string> {
  const baseEnv = opts.baseEnv ?? process.env;
  const managedKeys = opts.managedKeys ?? DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS;
  return buildFlowEnv({ baseEnv, allowKeys: opts.allowKeys, profile, managedKeys, mode: opts.mode });
}

export function buildProfileEnvOverlay(
  profile: ActiveProfile,
  managedKeys: readonly ManagedCredentialEnvKey[] = DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of managedKeys) {
    env[key] = profile.credentialsEnv[key] ?? "";
  }
  return env;
}
