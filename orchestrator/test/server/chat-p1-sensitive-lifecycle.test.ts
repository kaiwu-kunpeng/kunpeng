import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationStore } from "../../src/chat/conversation-store.js";
import { buildAuthConfig, writeAuthConfig } from "../../src/server/auth.js";
import { handleConversationAction } from "../../src/server/conversation-endpoints.js";
import { startDashboard, type DashboardOpts } from "../../src/server/http.js";

const roots: string[] = [];

function temp(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function storeAt(baseDir: string): ConversationStore {
  let seq = 0;
  return new ConversationStore(baseDir, {
    now: () => 1000 + (++seq),
    id: () => `conv-p1-${++seq}`,
  });
}

const searchedTurns = [
  { role: "user" as const, text: "查找私密报告" },
  { role: "assistant" as const, text: "结果 https://secret.example/report", web: true },
];

describe("敏感历史不可追溯捕获", () => {
  it("敏感会话解锁后归档仍永不捕获，分叉继承永久边界", async () => {
    const store = storeAt(temp("kp-chat-p1-sensitive-"));
    const conversation = await store.create("acct-1", {
      model: "claude-opus-5",
      projectId: "kunpeng",
      sensitive: true,
    });
    await store.appendTurns("acct-1", conversation.id, searchedTurns);
    await store.setSensitive("acct-1", conversation.id, false);

    const capture = vi.fn(async () => undefined);
    const archived = await handleConversationAction("DELETE", conversation.id, {}, {
      store,
      username: "acct-1",
      captureSearched: capture,
    });
    expect(archived.status).toBe(200);
    expect(capture).toHaveBeenCalledTimes(0);
    const stored = await store.get("acct-1", conversation.id);
    expect(stored).toMatchObject({ sensitive: false, sensitiveEver: true, archived: true });
    expect(stored?.capturedToKb).not.toBe(true);

    const forked = await store.fork("acct-1", conversation.id);
    expect(forked).toMatchObject({ sensitive: false, sensitiveEver: true });
    const forkCapture = vi.fn(async () => undefined);
    await handleConversationAction("DELETE", forked?.id ?? "missing", {}, {
      store,
      username: "acct-1",
      captureSearched: forkCapture,
    });
    expect(forkCapture).toHaveBeenCalledTimes(0);
  });

  it("纯非敏感新会话仍精确捕获一次并标记", async () => {
    const store = storeAt(temp("kp-chat-p1-plain-"));
    const conversation = await store.create("acct-1", { model: "claude-opus-5", projectId: "kunpeng" });
    await store.appendTurns("acct-1", conversation.id, searchedTurns);
    expect((await store.get("acct-1", conversation.id))?.sensitiveEver).toBe(false);

    const capture = vi.fn(async () => undefined);
    await handleConversationAction("DELETE", conversation.id, {}, {
      store,
      username: "acct-1",
      captureSearched: capture,
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect((await store.get("acct-1", conversation.id))?.capturedToKb).toBe(true);
  });

  it("缺少 sensitiveEver 的旧数据按未知即敏感处理", async () => {
    const baseDir = temp("kp-chat-p1-legacy-");
    const ownerDir = join(baseDir, encodeURIComponent("acct-legacy"));
    mkdirSync(ownerDir, { recursive: true });
    writeFileSync(join(ownerDir, `${encodeURIComponent("legacy-conv")}.json`), `${JSON.stringify({
      schemaVersion: 1,
      id: "legacy-conv",
      title: "旧会话",
      username: "acct-legacy",
      projectId: "kunpeng",
      model: "claude-opus-5",
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      sensitive: false,
      pinned: false,
      turns: searchedTurns,
    }, null, 2)}\n`, "utf8");

    const store = storeAt(baseDir);
    const capture = vi.fn(async () => undefined);
    await handleConversationAction("DELETE", "legacy-conv", {}, {
      store,
      username: "acct-legacy",
      captureSearched: capture,
    });
    expect(capture).toHaveBeenCalledTimes(0);
    expect((await store.get("acct-legacy", "legacy-conv"))?.sensitiveEver).toBe(true);
  });
});

async function login(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "owner", password: "password" }),
  });
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return (setCookie ?? "").split(";")[0] ?? "";
}

describe("异地新会话由服务端强制默认敏感", () => {
  it("真 HTTP 拒绝客户端用 false/省略绕过，且本机 false 保持非敏感", async () => {
    const repoRoot = temp("kp-chat-p1-http-repo-");
    const stateDir = temp("kp-chat-p1-http-state-");
    await writeAuthConfig(stateDir, buildAuthConfig("owner", "password", {
      salt: "owner-salt",
      secret: "owner-secret",
      now: 1,
    }));

    const observed: Array<boolean | undefined> = [];
    const fakeStream: NonNullable<DashboardOpts["streamChat"]> = async (
      _workspaceId,
      _message,
      _model,
      _imageIds,
      _web,
      _cwd,
      response,
      deps,
    ) => {
      observed.push(deps?.sensitive);
      response.statusCode = 204;
      response.end();
    };
    const server = await startDashboard({ port: 0, repoRoot, stateDir, streamChat: fakeStream });
    try {
      const cookie = await login(server.port);
      const projectId = encodeURIComponent(basename(repoRoot));
      const post = (body: Record<string, unknown>, remote: boolean) => fetch(
        `http://127.0.0.1:${server.port}/api/workspace/${projectId}/chat`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            ...(remote ? { "x-forwarded-for": "203.0.113.8" } : {}),
          },
          body: JSON.stringify({ message: "只做方案", mode: "plan", ...body }),
        },
      );

      expect((await post({ sensitive: false }, true)).status).toBe(204);
      expect((await post({}, true)).status).toBe(204);
      expect((await post({ sensitive: false }, false)).status).toBe(204);
      expect(observed).toEqual([true, true, false]);
    } finally {
      server.close();
    }
  });
});