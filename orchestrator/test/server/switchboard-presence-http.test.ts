import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { startDashboard } from "../../src/server/http.js";
import { findEscalations, type Escalation } from "../../src/switchboard/escalation.js";
import { PresenceStore } from "../../src/switchboard/presence.js";
import { newMessage, SwitchboardStore } from "../../src/switchboard/store.js";

const tempDirs: string[] = [];
const servers: Array<{ close: () => void }> = [];

async function makeStateDir(): Promise<string> {
  const stateDir = await mkdtemp(join(tmpdir(), "kunpeng-switchboard-presence-http-"));
  tempDirs.push(stateDir);
  return stateDir;
}

async function startTestDashboard(stateDir: string): Promise<string> {
  const server = await startDashboard({ port: 0, stateDir });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return await response.json() as T;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.close();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("switchboard presence HTTP endpoints", () => {
  test("GET /api/switchboard/escalations 列出未读紧急+收件人离线", async () => {
    const stateDir = await makeStateDir();
    const store = new SwitchboardStore(join(stateDir, "switchboard"));
    const msg = newMessage(
      { from: "main", to: "cockpit", body: "help", urgent: true },
      { now: Date.now, id: () => "msg-urgent-offline" },
    );
    await store.append(msg);

    const baseUrl = await startTestDashboard(stateDir);
    const data = await getJson<{ ok: true; escalations: Escalation[] }>(
      `${baseUrl}/api/switchboard/escalations`,
    );

    expect(data.ok).toBe(true);
    expect(data.escalations).toHaveLength(1);
    expect(data.escalations[0].reason).toBe("recipient-offline");
  });

  test("GET /api/switchboard/presence 返回在线实例", async () => {
    const stateDir = await makeStateDir();
    await new PresenceStore(join(stateDir, "presence")).beat("main", Date.now());

    const baseUrl = await startTestDashboard(stateDir);
    const data = await getJson<{ ok: true; online: string[] }>(
      `${baseUrl}/api/switchboard/presence`,
    );

    expect(data.ok).toBe(true);
    expect(data.online).toContain("main");
  });

  test("POST send urgent:true → 该消息进 escalations", async () => {
    const stateDir = await makeStateDir();
    const baseUrl = await startTestDashboard(stateDir);
    const response = await fetch(`${baseUrl}/api/switchboard/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "cockpit", body: "x", urgent: true, from: "main" }),
    });
    const sent = await response.json() as { ok: true; id: string };
    expect(sent.ok).toBe(true);

    const data = await getJson<{ ok: true; escalations: ReturnType<typeof findEscalations> }>(
      `${baseUrl}/api/switchboard/escalations`,
    );

    expect(data.ok).toBe(true);
    expect(data.escalations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason: "recipient-offline",
        message: expect.objectContaining({
          id: sent.id,
          from: "main",
          to: "cockpit",
          body: "x",
          urgent: true,
        }),
      }),
    ]));
  });
});
