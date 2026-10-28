import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function kunpengVersion(): string {
  try {
    const packagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    const parsed: unknown = JSON.parse(readFileSync(packagePath, "utf8"));
    if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string") {
      return parsed.version;
    }
  } catch {
    // 版本元数据不可用时保持 CLI 可运行，并返回约定的安全默认值。
  }
  return "0.0.0";
}

export function versionInfo(): { version: string; node: string; platform: string } {
  return {
    version: kunpengVersion(),
    node: process.version,
    platform: process.platform,
  };
}
