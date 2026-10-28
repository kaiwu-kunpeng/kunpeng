import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ConversationStore } from "../../src/chat/conversation-store.js";
import { deriveAccountId, hashPassword, signSession, writeAuthConfig, type AuthConfig } from "../../src/server/auth.js";
import { requestAuthContext } from "../../src/server/auth-context.js";
import { resolveConversationId } from "../../src/server/chat-persistence.js";
import { chatInvocation } from "../../src/server/chat-stream.js";
import { startDashboard } from "../../src/server/http.js";
import {
  handleWorkspaceRoute,
  isChatModeAllowedForRole,
  type WorkspaceRouteDeps,
} from "../../src/server/workspace-route.js";

class FakeResponse extends EventEmitter {
  statusCode = 200;
  body = "";
  readonly headers = new Map<string, unknown>();

  setHeader(name: string, value: unknown): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers ?? {})) this.setHeader(name, value);
    return this;
  }

  write(chunk: unknown): boolean {
    this.body += String(chunk);
    return true;
  }

  end(chunk?: unknown): this {
    if (chunk !== undefined) this.body += String(chunk);
    return this;
  }
}

function jsonRequest(body: unknown): IncomingMessage {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  Object.assign(req, {
    headers: { host: "cockpit.test", "sec-fetch-site": "same-origin" },
  });
  return req;
}

function response(): { raw: FakeResponse; res: ServerResponse } {
  const raw = new FakeResponse();
  return { raw, res: raw as unknown as ServerResponse };
}

function routeDeps(overrides: Partial<WorkspaceRouteDeps> = {}) {
  const resolveCwd = vi.fn(async () => "/repos/project-a");
  const stream = vi.fn<NonNullable<WorkspaceRouteDeps["streamChat"]>>(async () => undefined);
  const deps: WorkspaceRouteDeps = {
    resolveCwd,
    streamChat: stream,
    ...overrides,
  };
  return { deps, resolveCwd, stream };
}

describe("CHAT-01 member 权限在 agent 启动前 fail-closed", () => {
  it("纯决策只允许 member 的最终 Plan 模式", () => {
    expect(isChatModeAllowedForRole("member", "解释方案", "plan")).toBe(true);
    expect(isChatModeAllowedForRole("member", "/ask 解释方案", "act")).toBe(true);
    expect(isChatModeAllowedForRole("member", "直接修改", "act")).toBe(false);
    expect(isChatModeAllowedForRole("member", "/act 直接修改", "plan")).toBe(false);
    expect(isChatModeAllowedForRole("owner", "直接修改", "act")).toBe(true);
    expect(isChatModeAllowedForRole(undefined, "直接修改", "act")).toBe(true);
  });

  it.each([
    { message: "直接修改文件", mode: "act" },
    { message: "/act 直接修改文件", mode: "plan" },
  ])("member 越权请求返回 403 且不解析 cwd、不启动 agent: $message", async ({ message, mode }) => {
    const { deps, resolveCwd, stream } = routeDeps();
    const { raw, res } = response();
    await requestAuthContext.run(
      { username: "member", profileId: "home", role: "member" },
      () => handleWorkspaceRoute(
        "POST",
        "/api/workspace/project-a/chat",
        jsonRequest({ message, mode, model: "codex" }),
        res,
        deps,
      ),
    );
    expect(raw.statusCode).toBe(403);
    expect(resolveCwd).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it("member /ask 只读模式使用 resolver 返回的授权 cwd", async () => {
    const { deps, resolveCwd, stream } = routeDeps();
    const { raw, res } = response();
    await requestAuthContext.run(
      { username: "member", profileId: "home", role: "member" },
      () => handleWorkspaceRoute(
        "POST",
        "/api/workspace/project-a/chat",
        jsonRequest({ message: "/ask 解释架构", mode: "act", model: "codex" }),
        res,
        deps,
      ),
    );
    expect(raw.statusCode).toBe(200);
    expect(resolveCwd).toHaveBeenCalledWith("project-a");
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0]?.[5]).toBe("/repos/project-a");
  });

  it("未知项目对 owner 也返回 403，不启动 agent", async () => {
    const stream = vi.fn<NonNullable<WorkspaceRouteDeps["streamChat"]>>(async () => undefined);
    const { raw, res } = response();
    await requestAuthContext.run(
      { username: "owner", profileId: "home", role: "owner" },
      () => handleWorkspaceRoute(
        "POST",
        "/api/workspace/foreign/chat",
        jsonRequest({ message: "查看状态", mode: "act", model: "claude-opus-5" }),
        res,
        {
          resolveCwd: async () => null,
          streamChat: stream,
        },
      ),
    );
    expect(raw.statusCode).toBe(403);
    expect(stream).not.toHaveBeenCalled();
  });
});

describe("CHAT-01 agent 参数与 CHAT-02 项目绑定", () => {
  it("Codex Plan 是显式只读 sandbox，Act 才保留 bypass", () => {
    const plan = chatInvocation("codex", [], false, undefined, false, undefined, "plan");
    expect(plan.args).toEqual(expect.arrayContaining(["--sandbox", "read-only"]));
    expect(plan.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");

    const act = chatInvocation("codex", [], false, undefined, false, undefined, "act");
    expect(act.args).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("显式 conv 跨项目时创建当前项目的新会话，不复用旧历史", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-chat-project-bind-"));
    const ids = ["conv-a", "conv-b"];
    const store = new ConversationStore(dir, { now: () => 100, id: () => ids.shift() ?? "conv-extra" });
    try {
      const original = await store.create("alice", { model: "claude-opus-5", projectId: "project-a" });
      await store.appendTurns("alice", original.id, [
        { role: "user", text: "PROJECT-A-SECRET" },
        { role: "assistant", text: "收到" },
      ]);

      const resolved = await resolveConversationId(store, "alice", {
        conv: original.id,
        model: "claude-opus-5",
        projectId: "project-b",
      });

      expect(resolved).toBe("conv-b");
      expect(resolved).not.toBe(original.id);
      expect((await store.get("alice", resolved))?.projectId).toBe("project-b");
      expect((await store.get("alice", resolved))?.turns).toEqual([]);
      expect((await store.get("alice", original.id))?.projectId).toBe("project-a");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("远程 chat 服务端敏感默认", () => {
  it("真 HTTP 远程请求强制敏感，本机直连尊重显式 false", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-chat-remote-repo-"));
    const stateDir = mkdtempSync(join(tmpdir(), "kp-chat-remote-state-"));
    const secret = "chat-remote-secret";
    const salt = "chat-remote-salt";
    const accountId = deriveAccountId(secret, salt);
    const auth: AuthConfig = {
      secret,
      accounts: [{
        id: accountId,
        username: "owner",
        salt,
        hash: hashPassword("pw", salt),
        profileId: "home",
        role: "owner",
        updatedAt: 1,
      }],
    };
    await writeAuthConfig(stateDir, auth);

    const seenSensitive: Array<boolean | undefined> = [];
    const stream: NonNullable<WorkspaceRouteDeps["streamChat"]> = async (
      _workspaceId,
      _message,
      _model,
      _imageIds,
      _web,
      _cwd,
      res,
      chatDeps,
    ) => {
      seenSensitive.push(chatDeps?.sensitive);
      res.statusCode = 204;
      res.end();
    };
    const server = await startDashboard({
      port: 0,
      repoRoot: repo,
      stateDir,
      streamChat: stream,
    });
    const cookie = `kp_session=${signSession(accountId, "home", secret, Date.now())}`;
    const post = (body: Record<string, unknown>, remote: boolean) => fetch(
      `http://127.0.0.1:${server.port}/api/workspace/project-a/chat`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          ...(remote ? { "x-forwarded-for": "203.0.113.10" } : {}),
        },
        body: JSON.stringify(body),
      },
    );

    try {
      expect((await post({ message: "remote false", sensitive: false }, true)).status).toBe(204);
      expect((await post({ message: "remote omitted" }, true)).status).toBe(204);
      expect((await post({ message: "local false", sensitive: false }, false)).status).toBe(204);
      expect(seenSensitive).toEqual([true, true, false]);
    } finally {
      server.close();
      rmSync(repo, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
