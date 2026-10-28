import { isRecord } from "../util/is-record.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isNodeError } from "../util/errors.js";

interface PackageManifest {
  name: string;
  version: string;
}

function parsePackageManifest(raw: string): PackageManifest {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || typeof parsed.name !== "string" || parsed.name.length === 0) {
    throw new Error("kunpeng-plugin.json must contain a name");
  }
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("kunpeng-plugin.json must contain a version");
  }
  return { name: parsed.name, version: parsed.version };
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function packPlugin(
  dir: string,
  outPath?: string,
): Promise<{ path: string; sha256: string }> {
  const absoluteDir = resolve(dir);
  const manifest = parsePackageManifest(
    await readFile(join(absoluteDir, "kunpeng-plugin.json"), "utf8"),
  );
  const absoluteOutPath = outPath === undefined
    ? join(dirname(absoluteDir), `${manifest.name}-${manifest.version}.kpkg`)
    : resolve(outPath);

  execFileSync("zip", ["-r", "-q", absoluteOutPath, "."], {
    cwd: absoluteDir,
    timeout: 60_000,
  });

  const digest = await sha256(absoluteOutPath);
  await writeFile(`${absoluteOutPath}.sha256`, `${digest}\n`, "utf8");
  return { path: absoluteOutPath, sha256: digest };
}

export async function unpackKpkg(file: string, destRoot: string): Promise<string> {
  const absoluteFile = resolve(file);
  const sidecarPath = `${absoluteFile}.sha256`;
  let expectedDigest: string | undefined;
  try {
    expectedDigest = (await readFile(sidecarPath, "utf8")).trim();
  } catch (error: unknown) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }

  if (expectedDigest !== undefined) {
    const actualDigest = await sha256(absoluteFile);
    if (expectedDigest.toLowerCase() !== actualDigest) {
      throw new Error(`sha256 mismatch for ${absoluteFile}`);
    }
  }

  const packageName = basename(absoluteFile).endsWith(".kpkg")
    ? basename(absoluteFile).slice(0, -".kpkg".length)
    : basename(absoluteFile);
  const targetDir = resolve(destRoot, packageName);
  await mkdir(targetDir, { recursive: true });
  execFileSync("/usr/bin/unzip", ["-o", "-q", absoluteFile, "-d", targetDir], {
    timeout: 60_000,
  });

  const manifestPath = join(targetDir, "kunpeng-plugin.json");
  try {
    const manifestStat = await stat(manifestPath);
    if (!manifestStat.isFile()) throw new Error(`missing kunpeng-plugin.json at ${manifestPath}`);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`missing kunpeng-plugin.json at ${manifestPath}`, { cause: error });
    }
    throw error;
  }
  return targetDir;
}
