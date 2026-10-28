import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { isOnline, PresenceStore } from "../../src/switchboard/presence.js";

const tempDirs: string[] = [];

async function makeStore(): Promise<{ dir: string; store: PresenceStore }> {
  const dir = await mkdtemp(join(tmpdir(), "presence-"));
  tempDirs.push(dir);
  return { dir, store: new PresenceStore(dir) };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("isOnline", () => {
  test("isOnline:窗口内 true、窗口外 false", () => {
    expect(isOnline(1000, 1500, 1000)).toBe(true);
    expect(isOnline(1000, 3000, 1000)).toBe(false);
    expect(isOnline(1000, 2000, 1000)).toBe(true);
  });
});

describe("PresenceStore", () => {
  test("beat 写入、list 读回", async () => {
    const { store } = await makeStore();

    await store.beat("a", 100);
    await store.beat("b", 200);

    const listed = await store.list();
    expect(listed).toHaveLength(2);
    expect(listed.map((heartbeat) => heartbeat.instance)).toEqual(["b", "a"]);
    expect(listed.map((heartbeat) => heartbeat.ts)).toEqual([200, 100]);
  });

  test("beat 覆盖式刷新同实例", async () => {
    const { store } = await makeStore();

    await store.beat("a", 100);
    await store.beat("a", 500);

    const listed = await store.list();
    expect(listed.filter((heartbeat) => heartbeat.instance === "a")).toHaveLength(1);
    expect(listed.find((heartbeat) => heartbeat.instance === "a")?.ts).toBe(500);
  });

  test("online:只返回窗口内", async () => {
    const { store } = await makeStore();

    await store.beat("a", 1000);
    await store.beat("b", 5000);

    const online = await store.online(5000, 1000);
    expect(online).toContain("b");
    expect(online).not.toContain("a");
  });

  test("坏档跳过不崩", async () => {
    const { dir, store } = await makeStore();

    await store.beat("good", 100);
    await writeFile(join(dir, "bad.json"), "{不是json");

    await expect(store.list()).resolves.toEqual([{ instance: "good", ts: 100 }]);
  });
});
