export const SECRET_ENV_PATTERN = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CRED|AUTH|APIKEY|PRIVATE)/i;

export const SECRET_ENV_NAMES = new Set([
  "DATABASE_URL",
  "npm_config__auth",
]);

export const ESSENTIAL_ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "TERM",
  "TMPDIR",
  "PWD",
]);

const EMBEDDED_CREDENTIAL_URL_PATTERN = /^[a-z][a-z\d+.-]*:\/\/[^\s/:?#]+:[^\s@/?#]+@[^\s/]+/i;

function hasEmbeddedCredentials(value: string | undefined): boolean {
  return value !== undefined && EMBEDDED_CREDENTIAL_URL_PATTERN.test(value);
}

export function scrubExecEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(source)) {
    if (ESSENTIAL_ENV_NAMES.has(name)) {
      scrubbed[name] = value;
      continue;
    }
    if (SECRET_ENV_NAMES.has(name) || SECRET_ENV_PATTERN.test(name)) continue;
    if (hasEmbeddedCredentials(value)) continue;
    scrubbed[name] = value;
  }

  return scrubbed;
}
