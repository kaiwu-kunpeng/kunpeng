import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  INSTANCE_FILE,
  readInstanceFileSync,
  resolveIdentity,
  writeInstanceFile,
} from "../../src/switchboard/identity.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-identity-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("resolveIdentity uses flag, env, instance file, then main in priority order", () => {
  writeFileSync(join(dir, INSTANCE_FILE), " file-id \n");

  expect(resolveIdentity({ cwd: dir, flagValue: " flag-id ", env: " env-id " })).toBe("flag-id");
  expect(resolveIdentity({ cwd: dir, flagValue: "  ", env: " env-id " })).toBe("env-id");
  expect(resolveIdentity({ cwd: dir, flagValue: "", env: "  " })).toBe("file-id");
  expect(resolveIdentity({ cwd: dir, flagValue: "", env: "", readInstanceFile: () => null })).toBe("main");
});

test("resolveIdentity ignores blank instance file values", () => {
  writeFileSync(join(dir, INSTANCE_FILE), " \n\t");

  expect(resolveIdentity({ cwd: dir, flagValue: " ", env: " " })).toBe("main");
});

test("readInstanceFileSync reads trimmed nonblank contents and returns null for missing, failed, or blank reads", () => {
  expect(readInstanceFileSync(dir)).toBeNull();

  writeFileSync(join(dir, INSTANCE_FILE), " instance-a \n");
  expect(readInstanceFileSync(dir)).toBe("instance-a");

  writeFileSync(join(dir, INSTANCE_FILE), "\n  \t");
  expect(readInstanceFileSync(dir)).toBeNull();

  expect(readInstanceFileSync(join(dir, "missing-child"))).toBeNull();
});

test("writeInstanceFile writes trimmed id plus newline and can be read synchronously", async () => {
  await writeInstanceFile(dir, " flow-1 ");

  expect(existsSync(join(dir, INSTANCE_FILE))).toBe(true);
  expect(readInstanceFileSync(dir)).toBe("flow-1");
});
