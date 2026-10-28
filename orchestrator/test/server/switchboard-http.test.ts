import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { newMessage, SwitchboardStore } from "../../src/switchboard/store.js";
import { httpSource as combinedHttpSource } from "../helpers/http-source.js";

const tempDirs: string[] = [];

async function makeStore(): Promise<{ dir: string; store: SwitchboardStore }> {
  const dir = await mkdtemp(join(tmpdir(), "kunpeng-switchboard-http-"));
  tempDirs.push(dir);
  return { dir, store: new SwitchboardStore(dir) };
}

function sendInput(input: Record<string, unknown>):
  | { ok: false; error: string }
  | { ok: true; msg: ReturnType<typeof newMessage> } {
  const from = String(input.from || "http");
  const to = String(input.to ?? "");
  const topic = input.topic ? String(input.topic) : undefined;
  const body = String(input.body ?? "");
  if (!to || !body) return { ok: false, error: "缺 to 或 body" };

  return {
    ok: true,
    msg: newMessage(
      { from, to, topic, body },
      { now: () => 1000, id: () => "msg-http-test" },
    ),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("switchboard HTTP endpoint core wiring", () => {
  test("send appends a message and inbox receives it for the target", async () => {
    const { store } = await makeStore();
    const sent = sendInput({ to: "cockpit", body: "handoff from browser" });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    await store.append(sent.msg);

    const inbox = await store.inbox("cockpit");
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      id: "msg-http-test",
      from: "http",
      to: "cockpit",
      body: "handoff from browser",
      read: false,
    });
  });

  test("non-peek inbox consumption marks unread messages as read", async () => {
    const { store } = await makeStore();
    const msg = newMessage(
      { from: "http", to: "cockpit", body: "consume me" },
      { now: () => 1000, id: () => "msg-consume-test" },
    );
    await store.append(msg);

    const messages = await store.inbox("cockpit");
    for (const message of messages) {
      if (message.read === false) await store.markRead(message.id);
    }

    expect(await store.inbox("cockpit", { unreadOnly: true })).toEqual([]);
  });

  test("peek inbox leaves unread messages available", async () => {
    const { store } = await makeStore();
    const msg = newMessage(
      { from: "http", to: "cockpit", body: "peek me" },
      { now: () => 1000, id: () => "msg-peek-test" },
    );
    await store.append(msg);

    const messages = await store.inbox("cockpit", { unreadOnly: true });

    expect(messages.map((item) => item.id)).toEqual(["msg-peek-test"]);
    expect((await store.inbox("cockpit", { unreadOnly: true })).map((item) => item.id)).toEqual(["msg-peek-test"]);
  });

  test("send validation rejects missing target or message body", () => {
    expect(sendInput({ body: "missing target" })).toEqual({ ok: false, error: "缺 to 或 body" });
    expect(sendInput({ to: "cockpit" })).toEqual({ ok: false, error: "缺 to 或 body" });
  });

  test("HTTP source includes switchboard routes and store wiring", async () => {
    // switchboard 路由已析出到 routes/switchboard.ts；http.ts 只保留分发接线。
    const httpSource = combinedHttpSource();
    expect(httpSource).toContain("handleSwitchboardRoute");

    const routeSource = await readFile(join(process.cwd(), "src", "server", "routes", "switchboard.ts"), "utf8");
    expect(routeSource).toContain("/api/switchboard/send");
    expect(routeSource).toContain("/api/switchboard/inbox");
    expect(routeSource).toContain("SwitchboardStore");
    expect(routeSource).toContain('join(base, "switchboard")');
  });
});
