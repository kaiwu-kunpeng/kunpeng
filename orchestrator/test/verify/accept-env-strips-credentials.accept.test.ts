import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diagnoseBlankFailure, runVerification } from "../../src/verify/gate.js";

const INJECTED = {
  NEON_DATABASE_URL: "postgres://demo:secret@db.example.test/app",
  SSH_AUTH_SOCK: "/tmp/demo-ssh-agent.sock",
  DRAIN_KEY: "demo-drain-key-value",
  DEMOTRAVEL_API_TOKEN: "demo-token-value",
} as const;

let cwd = "";
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "kp-accept-env-"));
  for (const [key, value] of Object.entries(INJECTED)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const key of Object.keys(INJECTED)) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(cwd, { recursive: true, force: true });
});

function envNames(output: string): string[] {
  return output.split("\n").map((line) => /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1]).filter((name): name is string => Boolean(name));
}

function expectStripped(output: string): void {
  const names = envNames(output);
  for (const key of Object.keys(INJECTED)) expect(names, key).not.toContain(key);
  for (const value of Object.values(INJECTED)) expect(output).not.toContain(value);
  expect(names).toContain("PATH");
  expect(names).toContain("HOME");
}

describe("验收命令的执行环境不带宿主凭据（作者锁定）", () => {
  it("runVerification 默认环境（继承 process.env）剥掉凭据，保留 PATH/HOME", async () => {
    const result = await runVerification({ cwd, cmd: "env" });
    expect(result.passed).toBe(true);
    expectStripped(result.output);
  });

  it("dev-cycle 形态的显式 env（{...process.env, TMPDIR}）同样剥掉凭据，TMPDIR 保留", async () => {
    const flowTmp = join(cwd, "flow-tmp");
    const result = await runVerification({ cwd, cmd: "printenv; echo TMPDIR_SEEN=$TMPDIR", env: { ...process.env, TMPDIR: flowTmp } });
    expect(result.passed).toBe(true);
    expectStripped(result.output);
    expect(result.output).toContain(`TMPDIR_SEEN=${flowTmp}`);
  });

  it("零输出失败的诊断重跑（diagnoseBlankFailure）也不带凭据", async () => {
    const report = await diagnoseBlankFailure({ cwd, cmd: "env | grep -E '^(PATH|HOME|NEON_DATABASE_URL|SSH_AUTH_SOCK|DRAIN_KEY|DEMOTRAVEL_API_TOKEN)=' > envdump.txt; exit 1", env: { ...process.env } });
    expect(report).toContain("envdump.txt");
    expectStripped(report);
  });
});