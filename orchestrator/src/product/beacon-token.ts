import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BEACON_SECRET_FILE = "beacon-secret";

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function beaconSecret(stateDir: string): Promise<string> {
  const path = join(stateDir, BEACON_SECRET_FILE);
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
  }

  const secret = randomBytes(32).toString("hex");
  try {
    await writeFile(path, secret, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return secret;
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "EEXIST") throw error;
    return readFile(path, "utf8");
  }
}

export function beaconToken(slug: string, secret: string): string {
  return createHmac("sha256", secret).update(slug).digest("hex").slice(0, 32);
}

export function verifyBeaconToken(slug: string, token: unknown, secret: string): boolean {
  if (typeof token !== "string" || token.length !== 32) return false;
  const actual = Buffer.from(token, "utf8");
  const expected = Buffer.from(beaconToken(slug, secret), "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
