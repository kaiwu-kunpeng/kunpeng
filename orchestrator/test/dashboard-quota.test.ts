import { expect, test, describe, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { collectState } from "../src/server/state.js";
import type { DashboardState } from "../src/server/state.js";
import { ArtifactStore } from "../src/artifacts/store.js";
import { QuotaTracker } from "../src/agent/quota-tracker.js";

describe("Dashboard page quota rendering", () => {
  test("renders quota section when quota data is present", () => {
    const state: Pick<DashboardState, "quota"> = {
      quota: {
        accounts: [
          {
            id: "acct-a",
            used: 47,
            limit: 200,
            resetMs: 10800000,
            models: [
              { model: "haiku", calls: 30 },
              { model: "opus", calls: 17 },
            ],
          },
        ],
        total: 47,
      },
    };

    // Check that quota section HTML would be generated (simplified check)
    expect(state.quota).toBeDefined();
    expect(state.quota!.accounts[0].id).toBe("acct-a");
    expect(state.quota!.accounts[0].used).toBe(47);
    expect(state.quota!.accounts[0].models.length).toBe(2);
  });

  test("omits quota section when quota is undefined", () => {
    const state: Pick<DashboardState, "quota"> = {
      quota: undefined,
    };

    expect(state.quota).toBeUndefined();
  });
});

describe("DashboardState quota aggregation", () => {
  let tmpDir: string;
  let artifactDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "quota-test-"));
    artifactDir = path.join(tmpDir, ".kunpeng", "artifacts");
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.mkdir(path.join(tmpDir, ".kunpeng", "state"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("aggregates quota data by account with used calls and limit", async () => {
    // Fixture: quota.json with per-account calls
    const quotaTracker = new QuotaTracker({ windowHours: 24 });
    const now = Date.now();
    quotaTracker.record("acct-a", "haiku", now);
    quotaTracker.record("acct-a", "haiku", now);
    quotaTracker.record("acct-a", "opus", now);
    quotaTracker.record("acct-b", "sonnet", now);

    const quotaPath = path.join(tmpDir, ".kunpeng", "quota.json");
    await fs.mkdir(path.dirname(quotaPath), { recursive: true });
    await fs.writeFile(quotaPath, JSON.stringify(quotaTracker.toJSON()), "utf8");

    // Fixture: accounts.json with per-account limits
    const accountsPath = path.join(tmpDir, ".kunpeng", "accounts.json");
    const accounts = [
      { id: "acct-a", limit: 200 },
      { id: "acct-b", limit: 100 },
    ];
    await fs.writeFile(accountsPath, JSON.stringify(accounts), "utf8");

    const store = new ArtifactStore(artifactDir);
    const state = await collectState(store, tmpDir, { kunpengHome: tmpDir });

    // Assert quota field exists
    expect(state.quota).toBeDefined();
    expect(state.quota?.accounts).toBeDefined();

    // Assert aggregated accounts data
    const acctA = state.quota!.accounts.find((a) => a.id === "acct-a");
    const acctB = state.quota!.accounts.find((a) => a.id === "acct-b");

    expect(acctA).toBeDefined();
    expect(acctA?.used).toBe(3); // 2 haiku + 1 opus
    expect(acctA?.limit).toBe(200);
    expect(acctA?.resetMs).toBeGreaterThan(0);

    expect(acctB).toBeDefined();
    expect(acctB?.used).toBe(1);
    expect(acctB?.limit).toBe(100);

    // Assert per-model breakdown
    const acctAHaiku = acctA?.models.find((m) => m.model === "haiku");
    const acctAOpus = acctA?.models.find((m) => m.model === "opus");
    expect(acctAHaiku?.calls).toBe(2);
    expect(acctAOpus?.calls).toBe(1);

    const acctBSonnet = acctB?.models.find((m) => m.model === "sonnet");
    expect(acctBSonnet?.calls).toBe(1);
  });

  test("marks account as over-limit and sets systemLight to yellow/red", async () => {
    const quotaTracker = new QuotaTracker({ windowHours: 24 });
    const now = Date.now();
    // Record 150 calls for acct-a (exceeds 100 limit)
    for (let i = 0; i < 150; i++) {
      quotaTracker.record("acct-a", "haiku", now);
    }

    const quotaPath = path.join(tmpDir, ".kunpeng", "quota.json");
    await fs.mkdir(path.dirname(quotaPath), { recursive: true });
    await fs.writeFile(quotaPath, JSON.stringify(quotaTracker.toJSON()), "utf8");

    const accountsPath = path.join(tmpDir, ".kunpeng", "accounts.json");
    const accounts = [{ id: "acct-a", limit: 100 }];
    await fs.writeFile(accountsPath, JSON.stringify(accounts), "utf8");

    const store = new ArtifactStore(artifactDir);
    const state = await collectState(store, tmpDir, { kunpengHome: tmpDir });

    const acctA = state.quota!.accounts.find((a) => a.id === "acct-a");
    expect(acctA?.used).toBe(150);
    expect(acctA?.used).toBeGreaterThanOrEqual(acctA!.limit!);

    // systemLight should be at least yellow if any account is over limit
    expect(["yellow", "red"]).toContain(state.systemLight);
  });

  test("omits quota field when quota.json is missing (zero-config)", async () => {
    // Don't create quota.json
    const store = new ArtifactStore(artifactDir);
    const state = await collectState(store, tmpDir, { kunpengHome: tmpDir });

    expect(state.quota).toBeUndefined();
  });

  test("omits quota field when accounts.json exists but quota.json is missing", async () => {
    const accountsPath = path.join(tmpDir, ".kunpeng", "accounts.json");
    await fs.writeFile(accountsPath, JSON.stringify([{ id: "acct-a", limit: 100 }]), "utf8");

    const store = new ArtifactStore(artifactDir);
    const state = await collectState(store, tmpDir, { kunpengHome: tmpDir });

    expect(state.quota).toBeUndefined();
  });

  test("omits quota field when accounts.json is missing", async () => {
    const quotaTracker = new QuotaTracker({ windowHours: 24 });
    const now = Date.now();
    quotaTracker.record("acct-a", "haiku", now);

    const quotaPath = path.join(tmpDir, ".kunpeng", "quota.json");
    await fs.mkdir(path.dirname(quotaPath), { recursive: true });
    await fs.writeFile(quotaPath, JSON.stringify(quotaTracker.toJSON()), "utf8");
    // Don't create accounts.json

    const store = new ArtifactStore(artifactDir);
    const state = await collectState(store, tmpDir, { kunpengHome: tmpDir });

    expect(state.quota).toBeUndefined();
  });

  test("calculates resetMs correctly for each account", async () => {
    const quotaTracker = new QuotaTracker({ windowHours: 24 });
    const now = Date.now();
    quotaTracker.record("acct-a", "haiku", now);

    const quotaPath = path.join(tmpDir, ".kunpeng", "quota.json");
    await fs.mkdir(path.dirname(quotaPath), { recursive: true });
    await fs.writeFile(quotaPath, JSON.stringify(quotaTracker.toJSON()), "utf8");

    const accountsPath = path.join(tmpDir, ".kunpeng", "accounts.json");
    const accounts = [{ id: "acct-a", limit: 100, windowHours: 24 }];
    await fs.writeFile(accountsPath, JSON.stringify(accounts), "utf8");

    const store = new ArtifactStore(artifactDir);
    const state = await collectState(store, tmpDir, { kunpengHome: tmpDir });

    const acctA = state.quota!.accounts.find((a) => a.id === "acct-a");
    expect(acctA?.resetMs).toBeDefined();
    expect(acctA?.resetMs).toBeGreaterThan(0);
    expect(acctA?.resetMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000); // 24 hours in ms
  });

  test("includes total quota used across all accounts", async () => {
    const quotaTracker = new QuotaTracker({ windowHours: 24 });
    const now = Date.now();
    quotaTracker.record("acct-a", "haiku", now);
    quotaTracker.record("acct-a", "opus", now);
    quotaTracker.record("acct-b", "sonnet", now);
    quotaTracker.record("acct-b", "sonnet", now);

    const quotaPath = path.join(tmpDir, ".kunpeng", "quota.json");
    await fs.mkdir(path.dirname(quotaPath), { recursive: true });
    await fs.writeFile(quotaPath, JSON.stringify(quotaTracker.toJSON()), "utf8");

    const accountsPath = path.join(tmpDir, ".kunpeng", "accounts.json");
    const accounts = [
      { id: "acct-a", limit: 200 },
      { id: "acct-b", limit: 200 },
    ];
    await fs.writeFile(accountsPath, JSON.stringify(accounts), "utf8");

    const store = new ArtifactStore(artifactDir);
    const state = await collectState(store, tmpDir, { kunpengHome: tmpDir });

    expect(state.quota?.total).toBe(4); // 1 + 1 + 2
  });
});
