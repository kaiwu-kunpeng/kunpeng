import { expect, test, describe } from "vitest";
import { expandEnv, resolveAccounts, loadAccounts } from "../src/agent/account-pool.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

describe("expandEnv", () => {
  test("expands ~ to home directory in values", () => {
    const home = os.homedir();
    const result = expandEnv({
      key1: "~/config",
      key2: "/absolute/path",
      key3: "relative/path",
    });
    expect(result.key1).toBe(path.join(home, "config"));
    expect(result.key2).toBe("/absolute/path");
    expect(result.key3).toBe("relative/path");
  });

  test("handles multiple ~ in a value", () => {
    const home = os.homedir();
    const result = expandEnv({
      key: "~/dir1/~/dir2",
    });
    expect(result.key).toBe(path.join(home, "dir1/~/dir2"));
  });

  test("returns empty object for empty input", () => {
    const result = expandEnv({});
    expect(result).toEqual({});
  });
});

describe("resolveAccounts", () => {
  test("validates required id field", () => {
    expect(() =>
      resolveAccounts([{ id: "account1" }])
    ).not.toThrow();
  });

  test("rejects missing id", () => {
    expect(() => resolveAccounts([{ env: {} }])).toThrow(/id.*required/i);
  });

  test("accepts optional env as Record<string, string>", () => {
    expect(() =>
      resolveAccounts([{ id: "acc1", env: { KEY: "value" } }])
    ).not.toThrow();
  });

  test("rejects env that is not an object", () => {
    expect(() =>
      resolveAccounts([{ id: "acc1", env: "not-an-object" }])
    ).toThrow(/env.*Record/i);
  });

  test("rejects env with non-string values", () => {
    expect(() =>
      resolveAccounts([{ id: "acc1", env: { KEY: 123 } }])
    ).toThrow(/env.*string/i);
  });

  test("accepts optional positive limit", () => {
    expect(() =>
      resolveAccounts([{ id: "acc1", limit: 100 }])
    ).not.toThrow();
  });

  test("rejects negative limit", () => {
    expect(() =>
      resolveAccounts([{ id: "acc1", limit: -1 }])
    ).toThrow(/limit.*positive/i);
  });

  test("rejects zero limit", () => {
    expect(() =>
      resolveAccounts([{ id: "acc1", limit: 0 }])
    ).toThrow(/limit.*positive/i);
  });

  test("rejects non-number limit", () => {
    expect(() =>
      resolveAccounts([{ id: "acc1", limit: "100" }])
    ).toThrow(/limit.*number/i);
  });

  test("accepts optional positive windowHours", () => {
    expect(() =>
      resolveAccounts([{ id: "acc1", windowHours: 24 }])
    ).not.toThrow();
  });

  test("rejects negative windowHours", () => {
    expect(() =>
      resolveAccounts([{ id: "acc1", windowHours: -1 }])
    ).toThrow(/windowHours.*positive/i);
  });

  test("rejects zero windowHours", () => {
    expect(() =>
      resolveAccounts([{ id: "acc1", windowHours: 0 }])
    ).toThrow(/windowHours.*positive/i);
  });

  test("accepts fractional windowHours", () => {
    expect(() =>
      resolveAccounts([{ id: "acc1", windowHours: 0.5 }])
    ).not.toThrow();
  });

  test("returns array of valid Account objects", () => {
    const result = resolveAccounts([
      { id: "acc1", env: { KEY: "val" }, limit: 50, windowHours: 12 },
      { id: "acc2" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "acc1",
      env: { KEY: "val" },
      limit: 50,
      windowHours: 12,
    });
    expect(result[1]).toEqual({ id: "acc2" });
  });

  test("provides helpful error message on validation failure", () => {
    try {
      resolveAccounts([{ id: "acc1", limit: -5 }]);
      expect.fail("Should have thrown");
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(Error);
      const message = e instanceof Error ? e.message : "";
      expect(message).toContain("limit");
      expect(message).toMatch(/positive|must be/i);
    }
  });
});

describe("loadAccounts", () => {
  test("returns empty array when no accounts configured", async () => {
    const result = await loadAccounts({
      home: "/nonexistent",
      envPath: "/nonexistent/env/path",
    });
    expect(result).toEqual([]);
  });

  test("loads from KUNPENG_ACCOUNTS env var if set", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kunpeng-"));
    const accountsFile = path.join(tmpDir, "accounts.json");
    await fs.writeFile(
      accountsFile,
      JSON.stringify([{ id: "from-env-var" }])
    );

    try {
      const result = await loadAccounts({
        envPath: accountsFile,
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("from-env-var");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("loads from home/.kunpeng/accounts.json as fallback", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kunpeng-"));
    const kunpengDir = path.join(tmpDir, ".kunpeng");
    const accountsFile = path.join(kunpengDir, "accounts.json");

    await fs.mkdir(kunpengDir, { recursive: true });
    await fs.writeFile(
      accountsFile,
      JSON.stringify([{ id: "from-home" }])
    );

    try {
      const result = await loadAccounts({ home: tmpDir });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("from-home");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("prefers KUNPENG_ACCOUNTS over home fallback", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kunpeng-"));
    const kunpengDir = path.join(tmpDir, ".kunpeng");
    const envPath = path.join(tmpDir, "env-accounts.json");
    const homePath = path.join(kunpengDir, "accounts.json");

    await fs.mkdir(kunpengDir, { recursive: true });
    await fs.writeFile(envPath, JSON.stringify([{ id: "from-env" }]));
    await fs.writeFile(homePath, JSON.stringify([{ id: "from-home" }]));

    try {
      const result = await loadAccounts({ home: tmpDir, envPath });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("from-env");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("returns empty array when file contains empty array", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kunpeng-"));
    const accountsFile = path.join(tmpDir, "accounts.json");
    await fs.writeFile(accountsFile, JSON.stringify([]));

    try {
      const result = await loadAccounts({ envPath: accountsFile });
      expect(result).toEqual([]);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("validates and expands loaded accounts", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kunpeng-"));
    const accountsFile = path.join(tmpDir, "accounts.json");
    const home = os.homedir();

    await fs.writeFile(
      accountsFile,
      JSON.stringify([
        {
          id: "acc1",
          env: { CONFIG_DIR: "~/config" },
          limit: 50,
          windowHours: 24,
        },
      ])
    );

    try {
      const result = await loadAccounts({ envPath: accountsFile });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "acc1",
        env: { CONFIG_DIR: path.join(home, "config") },
        limit: 50,
        windowHours: 24,
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("throws helpful error on invalid JSON", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kunpeng-"));
    const accountsFile = path.join(tmpDir, "accounts.json");
    await fs.writeFile(accountsFile, "not valid json");

    try {
      await expect(loadAccounts({ envPath: accountsFile })).rejects.toThrow(
        /JSON|parse/i
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("throws helpful error on schema validation failure", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kunpeng-"));
    const accountsFile = path.join(tmpDir, "accounts.json");
    await fs.writeFile(accountsFile, JSON.stringify([{ env: { KEY: "val" } }]));

    try {
      await expect(loadAccounts({ envPath: accountsFile })).rejects.toThrow(
        /id.*required|schema/i
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("integrates with AccountPool without breaking existing tests", async () => {
    // This test verifies existing AccountPool behavior still works
    const { AccountPool } = await import("../src/agent/account-pool.js");
    const pool = new AccountPool([
      { id: "a" },
      { id: "b", limit: 100 },
    ]);
    expect(pool.size).toBe(2);
    expect(pool.next().id).toBe("a");
  });
});
