import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startDashboard } from "../../src/server/http.js";
import { hashPassword, writeAuthConfig, type AuthConfig } from "../../src/server/auth.js";
import { writeProfileRegistry } from "../../src/project/registry-profile.js";

async function jsonFetch(base: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  return {
    status: res.status,
    cookie: res.headers.get("set-cookie") ?? "",
    body: text ? JSON.parse(text) as Record<string, unknown> : {},
  };
}

describe("account isolation e2e", () => {
  it("isolates profiles and account admin over real http", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-authz-e2e-"));
    const acmeRepo = join(dir, "repos", "acme-shop");
    const travelerRepo = join(dir, "repos", "demo-travel");
    await mkdir(join(acmeRepo, ".kunpeng", "state"), { recursive: true });
    await mkdir(join(travelerRepo, ".kunpeng", "state"), { recursive: true });

    writeProfileRegistry(join(dir, "profiles", "home", "projects.json"), [
      { id: "acme-shop", name: "AcmeShop", repoPath: acmeRepo, registeredAt: 1 },
    ]);
    writeProfileRegistry(join(dir, "profiles", "client-x", "projects.json"), [
      { id: "demo-travel", name: "DemoTravel", repoPath: travelerRepo, registeredAt: 2 },
    ]);

    const secret = "sec-e2e";
    const cfg: AuthConfig = {
      secret,
      accounts: [
        { username: "admin", salt: "s1", hash: hashPassword("pw", "s1"), profileId: "home", role: "owner", updatedAt: 1 },
        { username: "admin1", salt: "s2", hash: hashPassword("pw", "s2"), profileId: "client-x", role: "member", updatedAt: 1 },
      ],
    };
    await writeAuthConfig(dir, cfg);

    const server = await startDashboard({ port: 0, stateDir: dir });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const adminLogin = await jsonFetch(base, "/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "pw" }),
      });
      const memberLogin = await jsonFetch(base, "/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin1", password: "pw" }),
      });

      const adminProjects = await jsonFetch(base, "/api/projects", { headers: { cookie: adminLogin.cookie } });
      const memberProjects = await jsonFetch(base, "/api/projects", { headers: { cookie: memberLogin.cookie } });
      expect((adminProjects.body.projects as { id: string }[]).map((p) => p.id)).toEqual(["acme-shop"]);
      expect((memberProjects.body.projects as { id: string }[]).map((p) => p.id)).toEqual(["demo-travel"]);

      const forbiddenLog = await jsonFetch(base, "/api/flow-log?projectId=acme-shop&flowId=f1", { headers: { cookie: memberLogin.cookie } });
      expect(forbiddenLog.status).toBe(403);

      const memberAccounts = await jsonFetch(base, "/api/accounts", { headers: { cookie: memberLogin.cookie } });
      const adminAccounts = await jsonFetch(base, "/api/accounts", { headers: { cookie: adminLogin.cookie } });
      expect(memberAccounts.status).toBe(403);
      expect(adminAccounts.status).toBe(200);
      expect(JSON.stringify(adminAccounts.body)).not.toContain(hashPassword("pw", "s1"));

      const noCookie = await jsonFetch(base, "/api/projects");
      expect(noCookie.status).toBe(401);

      await writeAuthConfig(dir, { ...cfg, accounts: cfg.accounts.filter((account) => account.username !== "admin1") });
      const deletedAccount = await jsonFetch(base, "/api/view", { headers: { cookie: memberLogin.cookie } });
      expect(deletedAccount.status).toBe(401);

      const created = await jsonFetch(base, "/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminLogin.cookie },
        body: JSON.stringify({ username: "admin2", password: "pw2", profileId: "client-x" }),
      });
      expect(created.status).toBe(200);
      expect((created.body.accounts as { username: string }[]).some((account) => account.username === "admin2")).toBe(true);
    } finally {
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
