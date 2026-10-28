import { expect, test } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { Account } from "../src/agent/account-pool.js";
import { CliRunner } from "../src/agent/cli-runner.js";
import { QuotaTracker } from "../src/agent/quota-tracker.js";

test("CliRunner without accounts passes an allowlisted env (no host secrets)", async () => {
  let capturedEnv: Record<string, string> | undefined;
  process.env.CANARY_HOST_SECRET = "leak";
  const runner = new CliRunner({
    backend: "claude",
    exec: async (_f, _args, _cwd, env) => {
      capturedEnv = env;
      return { stdout: "", stderr: "" };
    },
  });

  await runner.run({
    stage: "spec",
    system: "",
    input: "test",
    tools: [],
    cwd: "/tmp",
  });

  delete process.env.CANARY_HOST_SECRET;
  expect(capturedEnv).toBeDefined();
  expect(capturedEnv?.PATH).toBe(process.env.PATH);
  expect(capturedEnv?.HOME).toBe(process.env.HOME);
  expect(capturedEnv).not.toHaveProperty("CANARY_HOST_SECRET");
});

test("CliRunner with accounts selects and injects account env", async () => {
  let capturedEnv: Record<string, string> | undefined;
  const accounts: Account[] = [
    { id: "account1", env: { API_KEY: "key1" } },
    { id: "account2", env: { API_KEY: "key2" } },
  ];
  const quota = new QuotaTracker();

  const runner = new CliRunner({
    backend: "claude",
    accounts,
    quota,
    exec: async (_f, _args, _cwd, env) => {
      capturedEnv = env;
      return { stdout: "", stderr: "" };
    },
  });

  await runner.run({
    stage: "spec",
    system: "",
    input: "test",
    tools: [],
    cwd: "/tmp",
  });

  expect(capturedEnv).toBeDefined();
  expect(capturedEnv).toHaveProperty("API_KEY");
  expect(["key1", "key2"]).toContain(capturedEnv?.API_KEY);
});

test("CliRunner records quota by account id when accounts configured", async () => {
  const accounts: Account[] = [
    { id: "account1", env: { API_KEY: "key1" } },
  ];
  const quota = new QuotaTracker();

  const runner = new CliRunner({
    backend: "claude",
    accounts,
    quota,
    exec: async () => ({ stdout: "", stderr: "" }),
  });

  await runner.run({
    stage: "spec",
    system: "",
    input: "test",
    tools: [],
    cwd: "/tmp",
  });

  const usage = quota.usage();
  expect(usage).toHaveLength(1);
  expect(usage[0].account).toBe("account1");
  expect(usage[0].calls).toBe(1);
});

test("CliRunner persists quota.json when quotaPath configured", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "quota-test-"));
  const quotaPath = path.join(tmpDir, "quota.json");

  try {
    const accounts: Account[] = [
      { id: "account1", env: { API_KEY: "key1" } },
    ];
    const quota = new QuotaTracker();

    const runner = new CliRunner({
      backend: "claude",
      accounts,
      quota,
      quotaPath,
      exec: async () => ({ stdout: "", stderr: "" }),
    });

    await runner.run({
      stage: "spec",
      system: "",
      input: "test",
      tools: [],
      cwd: "/tmp",
    });

    const fileContent = await fs.readFile(quotaPath, "utf-8");
    const persisted = JSON.parse(fileContent);

    expect(persisted).toHaveProperty("schema", "kunpeng-quota/v1");
    expect(persisted.records).toHaveLength(1);
    expect(persisted.records[0]).toMatchObject({
      account: "account1",
      calls: 1,
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("CliRunner selects account with lowest quota when multiple available", async () => {
  const selectedAccounts: string[] = [];
  const accounts: Account[] = [
    { id: "high-quota", env: { API_KEY: "high" } },
    { id: "low-quota", env: { API_KEY: "low" } },
  ];
  const quota = new QuotaTracker();

  quota.record("high-quota", "haiku", Date.now());
  quota.record("high-quota", "haiku", Date.now());
  quota.record("high-quota", "haiku", Date.now());

  const runner = new CliRunner({
    backend: "claude",
    accounts,
    quota,
    exec: async (_f, _args, _cwd, env) => {
      const key = env?.API_KEY;
      if (key) selectedAccounts.push(key);
      return { stdout: "", stderr: "" };
    },
  });

  await runner.run({
    stage: "spec",
    system: "",
    input: "test",
    tools: [],
    cwd: "/tmp",
  });

  await runner.run({
    stage: "spec",
    system: "",
    input: "test",
    tools: [],
    cwd: "/tmp",
  });

  expect(selectedAccounts).toEqual(["low", "low"]);
});