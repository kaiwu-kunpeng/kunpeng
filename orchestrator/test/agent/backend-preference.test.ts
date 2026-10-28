import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backendPrefPath, isValidBackendKind, readBackendPreference,
  resolveEffectiveKind, writeBackendPreference,
} from "../../src/agent/backend-preference.js";

describe("backend-preference 持久化 + 优先级", () => {
  let home: string;
  beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "kp-backend-")); });
  afterEach(async () => { await rm(home, { recursive: true, force: true }); });

  test("isValidBackendKind 只认 local / codex-cloud", () => {
    expect(isValidBackendKind("local")).toBe(true);
    expect(isValidBackendKind("codex-cloud")).toBe(true);
    expect(isValidBackendKind("nonsense")).toBe(false);
  });

  test("写后能读回(roundtrip)", async () => {
    expect(await readBackendPreference(home)).toBeUndefined();
    await writeBackendPreference(home, "codex-cloud");
    expect(await readBackendPreference(home)).toBe("codex-cloud");
    await writeBackendPreference(home, "local");
    expect(await readBackendPreference(home)).toBe("local");
  });

  test("偏好文件落在 backendPrefPath 且是合法 JSON", async () => {
    await writeBackendPreference(home, "codex-cloud");
    const raw = await readFile(backendPrefPath(home), "utf8");
    expect(JSON.parse(raw)).toEqual({ backend: "codex-cloud" });
  });

  test("损坏/非法偏好 → undefined(不抛)", async () => {
    await writeBackendPreference(home, "local");
    // 覆写成非法内容
    const { writeFile } = await import("node:fs/promises");
    await writeFile(backendPrefPath(home), "{ not json", "utf8");
    expect(await readBackendPreference(home)).toBeUndefined();
  });

  test("resolveEffectiveKind: env 显式合法 > 偏好 > local", () => {
    expect(resolveEffectiveKind({}, undefined)).toBe("local");
    expect(resolveEffectiveKind({}, "codex-cloud")).toBe("codex-cloud");
    expect(resolveEffectiveKind({ KUNPENG_EXECUTION_BACKEND: "local" }, "codex-cloud")).toBe("local");
    expect(resolveEffectiveKind({ KUNPENG_EXECUTION_BACKEND: "codex-cloud" }, undefined)).toBe("codex-cloud");
    // env 非法值被忽略,回落偏好
    expect(resolveEffectiveKind({ KUNPENG_EXECUTION_BACKEND: "garbage" }, "codex-cloud")).toBe("codex-cloud");
  });
});