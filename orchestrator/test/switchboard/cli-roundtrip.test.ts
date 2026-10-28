import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import "../../src/cli-commands/switchboard.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { newMessage, SwitchboardStore } from "../../src/switchboard/store.js";
import { cliSource } from "../helpers/cli-source.js";

const tempDirs: string[] = [];

async function makeStore(): Promise<{ dir: string; store: SwitchboardStore }> {
  const dir = await mkdtemp(join(tmpdir(), "kunpeng-switchboard-"));
  tempDirs.push(dir);
  return { dir, store: new SwitchboardStore(dir) };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("switchboard CLI roundtrip wiring", () => {
  test("direct messages arrive unread and disappear from unread inbox after markRead", async () => {
    const { store } = await makeStore();
    const msg = newMessage(
      { from: "main", to: "cockpit", body: "handoff ready" },
      { now: () => 1000, id: () => "msg-test-direct" },
    );

    await store.append(msg);

    const inbox = await store.inbox("cockpit");
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      id: "msg-test-direct",
      body: "handoff ready",
      read: false,
    });

    await store.markRead(msg.id);

    expect(await store.inbox("cockpit", { unreadOnly: true })).toEqual([]);
  });

  test("broadcast messages are visible to peer instances", async () => {
    const { store } = await makeStore();
    const msg = newMessage(
      { from: "main", to: "all", body: "broadcast update" },
      { now: () => 2000, id: () => "msg-test-broadcast" },
    );

    await store.append(msg);

    expect((await store.inbox("design")).map((item) => item.id)).toEqual(["msg-test-broadcast"]);
  });

  test("CLI source contains send and inbox dispatch through SwitchboardStore", () => {
    const cli = cliSource();

    expect(listCliCommands().map((command) => command.name)).toContain("send");
    expect(listCliCommands().map((command) => command.name)).toContain("inbox");
    expect(cli).toContain("new SwitchboardStore(dir)");
    expect(cli).toContain('join(kunpengStateDir(), "switchboard")');
  });
});
