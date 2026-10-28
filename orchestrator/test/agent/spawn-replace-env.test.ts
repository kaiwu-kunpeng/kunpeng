import { describe, expect, it } from "vitest";
import { spawnCapture } from "../../src/agent/cli-runner.js";
import { spawnStream } from "../../src/agent/cli-stream.js";

const PRINT_KEYS = ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))"];
const ENV = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp", KP_TEST_MARK: "1" };

describe("spawn 整体替换模式（作者锁定）", () => {
  it("spawnStream replaceEnv=true → 子进程只看到给定的键", async () => {
    const lines: string[] = [];
    const out = await spawnStream(process.execPath, PRINT_KEYS, process.cwd(), (line) => { lines.push(line); }, { env: ENV, replaceEnv: true, timeoutMs: 20_000 });
    const keys = JSON.parse(out.stdout || lines.join("")) as string[];
    expect(keys).toContain("KP_TEST_MARK");
    expect(keys).toContain("PATH");
    // macOS 会给每个子进程注入 __CF_USER_TEXT_ENCODING，与 env 参数无关，剔除后再判
    const leaked = keys.filter((k) => !k.startsWith("__CF_") && !(k in ENV));
    expect(leaked).toEqual([]);
    expect(keys).not.toContain("SHELL");
    expect(keys).not.toContain("USER");
  });

  it("spawnStream 缺省仍继承宿主 env（其它调用方行为不变）", async () => {
    const out = await spawnStream(process.execPath, PRINT_KEYS, process.cwd(), () => {}, { env: { KP_TEST_MARK: "1" }, timeoutMs: 20_000 });
    const keys = JSON.parse(out.stdout) as string[];
    expect(keys).toContain("KP_TEST_MARK");
    expect(keys.length).toBeGreaterThan(3);
  });

  it("spawnCapture replaceEnv=true → 同样只看到给定的键", async () => {
    const out = await spawnCapture(process.execPath, PRINT_KEYS, process.cwd(), 20_000, ENV, undefined, undefined, true);
    const keys = JSON.parse(out.stdout) as string[];
    // macOS 会给每个子进程注入 __CF_USER_TEXT_ENCODING，与 env 参数无关，剔除后再判
    const leaked = keys.filter((k) => !k.startsWith("__CF_") && !(k in ENV));
    expect(leaked).toEqual([]);
    expect(keys).not.toContain("SHELL");
    expect(keys).not.toContain("USER");
    expect(keys).toContain("KP_TEST_MARK");
  });
});