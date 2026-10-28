import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { DEFAULT_BACKEND_CONFIG, loadBackendConfig } from "../../src/agent/backend-config.js";

async function writeTempConfig(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "backend-config-"));
  const path = join(dir, "backends.json");
  await writeFile(path, content, "utf8");
  return path;
}

describe("backend config loader", () => {
  test("文件缺失→缺省", async () => {
    const config = await loadBackendConfig("/no/such/path.json");

    expect(config.routing.implement).toBe("codex");
    expect(config.routing.spec).toBe("claude");
    expect(config.enabled).toContain("claude");
    expect(config.enabled).toContain("codex");
    expect(config).toEqual(DEFAULT_BACKEND_CONFIG);
  });

  test("部分覆盖 routing→浅合并", async () => {
    const path = await writeTempConfig(JSON.stringify({ routing: { implement: "qwen" } }));

    const config = await loadBackendConfig(path);

    expect(config.routing.implement).toBe("qwen");
    expect(config.routing.spec).toBe("claude");
    expect(config.routing).toEqual({ ...DEFAULT_BACKEND_CONFIG.routing, implement: "qwen" });
    expect(config.enabled).toEqual(DEFAULT_BACKEND_CONFIG.enabled);
  });

  test("覆盖 enabled", async () => {
    const path = await writeTempConfig(JSON.stringify({ enabled: ["claude", "codex", "qwen"] }));

    const config = await loadBackendConfig(path);

    expect(config.enabled).toContain("qwen");
    expect(config.enabled).toEqual(["claude", "codex", "qwen"]);
    expect(config.routing).toEqual(DEFAULT_BACKEND_CONFIG.routing);
  });

  test("坏 json→缺省不抛", async () => {
    const path = await writeTempConfig("{不是json");

    await expect(loadBackendConfig(path)).resolves.toEqual(DEFAULT_BACKEND_CONFIG);
  });

  test("routing 类型不对(给数组)→routing 用缺省", async () => {
    const path = await writeTempConfig(JSON.stringify({ routing: ["x"] }));

    const config = await loadBackendConfig(path);

    expect(config.routing).toEqual(DEFAULT_BACKEND_CONFIG.routing);
  });

  test("enabled 空数组→用缺省", async () => {
    const path = await writeTempConfig(JSON.stringify({ enabled: [] }));

    const config = await loadBackendConfig(path);

    expect(config.enabled).toEqual(DEFAULT_BACKEND_CONFIG.enabled);
  });
});
