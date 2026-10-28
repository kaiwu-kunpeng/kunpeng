import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDepsSync } from "../src/runtime/deps-check.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kp-deps-check-"));
  dirs.push(dir);
  return dir;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("reports missing declared scoped dependency", async () => {
  const dir = tempDir();
  await writeJson(join(dir, "package.json"), {
    dependencies: {
      foo: "1",
      "@scope/bar": "1",
    },
  });
  await mkdir(join(dir, "node_modules", "foo"), { recursive: true });
  await writeJson(join(dir, "node_modules", "foo", "package.json"), {});

  const result = await checkDepsSync(dir);

  expect(result.missing).toContain("@scope/bar");
  expect(result.missing).not.toContain("foo");
});

test("returns empty missing list when package.json is absent", async () => {
  const dir = tempDir();

  await expect(checkDepsSync(dir)).resolves.toEqual({ missing: [] });
});

test("returns empty missing list when all dependencies exist", async () => {
  const dir = tempDir();
  await writeJson(join(dir, "package.json"), {
    dependencies: {
      foo: "1",
    },
    devDependencies: {
      "@scope/bar": "1",
    },
  });
  await mkdir(join(dir, "node_modules", "foo"), { recursive: true });
  await mkdir(join(dir, "node_modules", "@scope", "bar"), { recursive: true });
  await writeJson(join(dir, "node_modules", "foo", "package.json"), {});
  await writeJson(join(dir, "node_modules", "@scope", "bar", "package.json"), {});

  const result = await checkDepsSync(dir);

  expect(result.missing).toEqual([]);
});
