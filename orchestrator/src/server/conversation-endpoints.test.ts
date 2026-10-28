import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ConversationStore } from "../chat/conversation-store.js";
import { handleConversationAction } from "./conversation-endpoints.js";

// handleConversationAction(method, id, body, deps) -> {status, json}
// deps: { store, username, captureSearched }

function deps(base: string, username: string, captureSearched = vi.fn()) {
  let n = 0;
  const store = new ConversationStore(base, {
    now: () => ++n,
    id: () => `conv-${n}`,
  });
  return { store, username, captureSearched };
}

describe("conversation endpoints (account isolation enforced server-side)", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "kp-cep-"));
  });

  test("GET other user's id returns 404, never leaks", async () => {
    const a = deps(base, "alice");
    const c = await a.store.create("alice", { model: "m" });
    const b = deps(base, "bob");
    const r = await handleConversationAction("GET", c.id, null, b);
    expect(r.status).toBe(404);
  });

  test("DELETE soft-archives and triggers KB capture for searched data", async () => {
    const capture = vi.fn();
    const a = deps(base, "alice", capture);
    const c = await a.store.create("alice", { model: "m" });
    await a.store.appendTurns("alice", c.id, [
      { role: "user", text: "查一下" },
      { role: "assistant", text: "见 https://x.com/y", web: true },
    ]);
    const r = await handleConversationAction("DELETE", c.id, null, a);
    expect(r.status).toBe(200);
    expect((await a.store.get("alice", c.id))?.archived).toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  test("DELETE plain chat archives without KB capture", async () => {
    const capture = vi.fn();
    const a = deps(base, "alice", capture);
    const c = await a.store.create("alice", { model: "m" });
    await a.store.appendTurns("alice", c.id, [
      { role: "user", text: "你好" },
      { role: "assistant", text: "你好呀" },
    ]);
    await handleConversationAction("DELETE", c.id, null, a);
    expect(capture).not.toHaveBeenCalled();
  });

  test("unlocking a sensitive conversation never re-enables KB capture", async () => {
    const capture = vi.fn();
    const a = deps(base, "alice", capture);
    const c = await a.store.create("alice", { model: "m", sensitive: true });
    await a.store.appendTurns("alice", c.id, [
      { role: "user", text: "查一下" },
      { role: "assistant", text: "见 https://x.com/y", web: true },
    ]);
    await a.store.setSensitive("alice", c.id, false);

    await handleConversationAction("DELETE", c.id, null, a);

    expect(capture).not.toHaveBeenCalled();
    const archived = await a.store.get("alice", c.id);
    expect(archived?.sensitive).toBe(false);
    expect(archived?.sensitiveEver).toBe(true);
    expect(archived?.capturedToKb).not.toBe(true);
  });

  test("PATCH renames", async () => {
    const a = deps(base, "alice");
    const c = await a.store.create("alice", { model: "m" });
    const r = await handleConversationAction("PATCH", c.id, { title: "新名字" }, a);
    expect(r.status).toBe(200);
    expect((await a.store.get("alice", c.id))?.title).toBe("新名字");
  });
});
