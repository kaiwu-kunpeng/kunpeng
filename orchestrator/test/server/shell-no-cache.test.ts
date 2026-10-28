// 回归:cockpit 的 SPA 壳必须带 cache-control: no-cache。
// 否则浏览器启发式缓存旧壳(内联含 clientScript)→ 改了前端"没生效/又不见",普通刷新绕不过。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDashboard } from "../../src/server/http.js";
import { deriveAccountId, hashPassword, signSession, writeAuthConfig, type AuthConfig } from "../../src/server/auth.js";

const SECRET = "sec-shell-nocache";
const ACCOUNT_ID = deriveAccountId(SECRET, "s1");
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kp-shell-nocache-"));
  const cfg: AuthConfig = {
    secret: SECRET,
    accounts: [{ id: ACCOUNT_ID, username: "admin", salt: "s1", hash: hashPassword("pw", "s1"), profileId: "home", role: "owner", updatedAt: 1 }],
  };
  await writeAuthConfig(dir, cfg);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("cockpit SPA 壳缓存头", () => {
  it("GET / 带 cache-control: no-cache(防浏览器缓存旧壳)", async () => {
    const server = await startDashboard({ port: 0, stateDir: dir, repoRoot: dir });
    try {
      const tok = signSession(ACCOUNT_ID, "home", SECRET, Date.now());
      const r = await fetch(`http://127.0.0.1:${server.port}/`, { headers: { cookie: `kp_session=${tok}` } });
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-cache");
    } finally {
      server.close();
    }
  });

  it("登录页也带 no-cache", async () => {
    const server = await startDashboard({ port: 0, stateDir: dir, repoRoot: dir });
    try {
      const r = await fetch(`http://127.0.0.1:${server.port}/login`);
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-cache");
    } finally {
      server.close();
    }
  });
});
