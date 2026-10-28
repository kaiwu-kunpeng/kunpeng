import { homedir } from "node:os";
import { join } from "node:path";

export function kunpengStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const configuredStateDir = env.KUNPENG_STATE?.trim();
  return configuredStateDir || join(homedir(), ".kunpeng");
}
