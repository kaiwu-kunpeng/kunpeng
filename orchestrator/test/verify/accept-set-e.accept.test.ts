import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runVerification } from "../../src/verify/gate.js";

const SRC = new URL("../../src/", import.meta.url).pathname;
const run = (cmd: string, strict?: boolean) => runVerification({ cwd: tmpdir(), cmd, timeoutMs: 10_000, ...(strict === undefined ? {} : { strict }) });

describe("runVerification strict = set -e", () => {
  it("非末尾独立行失败 → strict 判失败；默认仍放行（行为不变）", async () => {
    expect((await run("false\necho ok", true)).passed).toBe(false);
    expect((await run("false\necho ok")).passed).toBe(true);
  });

  it("分号前失败 → strict 判失败", async () => {
    expect((await run("test -f /nonexistent-kp-b3; echo done", true)).passed).toBe(false);
  });

  it("合法写法在 strict 下仍通过", async () => {
    expect((await run("! grep -q never-there /dev/null && echo ok", true)).passed).toBe(true);
    expect((await run("if false; then :; fi\necho ok", true)).passed).toBe(true);
    expect((await run("false || true\necho ok", true)).passed).toBe(true);
    expect((await run("printf 'a\\nb\\n' | grep -q a", true)).passed).toBe(true);
  });

  it("管道掩盖仍是已知幸存（不开 pipefail）", async () => {
    expect((await run("false | true", true)).passed).toBe(true);
  });

  it("末行失败照旧判失败", async () => {
    expect((await run("echo ok\nfalse", true)).passed).toBe(false);
  });
});

describe("dev-cycle 只在两处验收调用开 strict", () => {
  const src = readFileSync(`${SRC}loop/dev-cycle.ts`, "utf8");
  it("acceptanceCmd 的两次执行都带 strict: true", () => {
    expect(src.split("runVerification({ cwd: flow.path, cmd: acceptanceCmd, env: verifyEnv, strict: true })").length - 1).toBe(2);
    expect(src).not.toContain("runVerification({ cwd: flow.path, cmd: acceptanceCmd, env: verifyEnv })");
  });
  it("项目检查调用不带 strict", () => {
    expect(src).toContain("runVerification({ cwd: flow.path, cmd, env: verifyEnv })");
    expect(src).not.toContain("cmd, env: verifyEnv, strict");
  });
});

describe("幸存表随之收缩", () => {
  it("只剩 package.json 与 pipe-mask", () => {
    const table = JSON.parse(readFileSync(`${SRC}verify/gate-survivors.json`, "utf8")) as string[];
    expect(table).toEqual(["sensitive:orchestrator/package.json", "verification:pipe-mask"]);
  });
});