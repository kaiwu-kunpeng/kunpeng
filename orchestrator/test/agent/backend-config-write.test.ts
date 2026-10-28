import { test, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeBackendConfigInput, saveBackendConfig, loadBackendConfig, DEFAULT_BACKEND_CONFIG } from "../../src/agent/backend-config.js";

test("规整：已知 stage 覆盖，未知字段忽略，enabled 净化", () => {
  const c = normalizeBackendConfigInput({ routing: { implement: "claude", bogus: "x" }, enabled: ["claude"] });
  expect(c.routing.implement).toBe("claude");
  expect((c.routing as Record<string, string>).bogus).toBeUndefined();
  expect(c.routing.spec).toBe(DEFAULT_BACKEND_CONFIG.routing.spec); // 未给的用缺省
  expect(c.enabled).toEqual(["claude"]);
});

test("规整：坏输入整体回退缺省（绝不写坏配置）", () => {
  expect(normalizeBackendConfigInput(null)).toEqual(DEFAULT_BACKEND_CONFIG);
  expect(normalizeBackendConfigInput({ routing: "nope", enabled: [1, 2] })).toEqual(DEFAULT_BACKEND_CONFIG);
});

test("落盘 + 读回一致（真实 fs 闭环）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kp-bw-"));
  try {
    const saved = await saveBackendConfig(dir, { routing: { implement: "claude" }, enabled: ["claude", "codex"] });
    expect(saved.routing.implement).toBe("claude");
    const onDisk = JSON.parse(await readFile(join(dir, ".kunpeng", "backends.json"), "utf8"));
    expect(onDisk.routing.implement).toBe("claude");
    const reloaded = await loadBackendConfig(join(dir, ".kunpeng", "backends.json"));
    expect(reloaded.routing.implement).toBe("claude");  // loadBackendConfig 能读回 saveBackendConfig 写的
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
