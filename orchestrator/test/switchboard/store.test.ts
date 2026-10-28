import { basename, dirname, join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { newMessage, SwitchboardStore, type FileSystem, type SwitchMessage } from "../../src/switchboard/store.js";

class MemoryFs implements FileSystem {
  files = new Map<string, string>();
  dirs = new Set<string>();

  access: FileSystem["access"] = async (path) => {
    if (typeof path !== "string") throw new Error("MemoryFs expects a string path");
    if (!this.files.has(path) && !this.dirs.has(path)) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    }
  }

  mkdir = (async (path: Parameters<FileSystem["mkdir"]>[0], options?: Parameters<FileSystem["mkdir"]>[1]) => {
    if (typeof path !== "string") throw new Error("MemoryFs expects a string path");
    this.dirs.add(path);
    return typeof options === "object" && options?.recursive ? path : undefined;
  }) as FileSystem["mkdir"];

  // Node overloads distinguish encoded text from a Buffer result.
  readFile = (async (...[path, options]: Parameters<FileSystem["readFile"]>) => {
    if (typeof path !== "string") throw new Error("MemoryFs expects a string path");
    const value = this.files.get(path);
    if (value === undefined) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    }
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? Buffer.from(value).toString(encoding) : Buffer.from(value);
  }) as FileSystem["readFile"];

  readdir = (async (path: Parameters<FileSystem["readdir"]>[0], options?: BufferEncoding | "buffer" | { encoding?: BufferEncoding | "buffer" | null; withFileTypes?: boolean; recursive?: boolean } | null) => {
    if (typeof path !== "string") throw new Error("MemoryFs expects a string path");
    if (typeof options === "object" && options?.withFileTypes) throw new Error("MemoryFs does not model Dirents");
    if (options === "buffer" || (typeof options === "object" && options?.encoding === "buffer")) throw new Error("MemoryFs expects text directory entries");
    if (!this.dirs.has(path)) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    }

    return [...this.files.keys()]
      .filter((file) => dirname(file) === path)
      .map((file) => basename(file));
  }) as FileSystem["readdir"];

  writeFile: FileSystem["writeFile"] = async (path, data, options) => {
    if (typeof path !== "string") throw new Error("MemoryFs expects a string path");
    if (typeof data !== "string" && !ArrayBuffer.isView(data)) throw new Error("MemoryFs expects text or bytes");
    if (typeof options === "object" && options?.flag === "wx" && this.files.has(path)) {
      throw Object.assign(new Error(`EEXIST: ${path}`), { code: "EEXIST" });
    }

    this.dirs.add(dirname(path));
    this.files.set(path, typeof data === "string" ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString());
  };
}

const dir = "/switchboard";

function msg(overrides: Partial<SwitchMessage> = {}): SwitchMessage {
  return {
    id: "m1",
    from: "sender",
    to: "receiver",
    body: "body",
    ts: 100,
    read: false,
    ...overrides,
  };
}

function makeStore(): { fs: MemoryFs; store: SwitchboardStore } {
  const fs = new MemoryFs();
  return { fs, store: new SwitchboardStore(dir, fs) };
}

describe("newMessage", () => {
  test("builds a deterministic unread message from injected deps", () => {
    const result = newMessage(
      { from: "a", to: "b", body: "hi" },
      { now: () => 1000, id: () => "m1" },
    );

    expect(result.id).toBe("m1");
    expect(result.ts).toBe(1000);
    expect(result.read).toBe(false);
    expect(result.topic).toBeUndefined();
  });

  test("includes urgent only when urgent is true", () => {
    const deps = { now: () => 1000, id: () => "m1" };

    expect(newMessage({ from: "a", to: "b", body: "x", urgent: true }, deps).urgent).toBe(true);
    expect(newMessage({ from: "a", to: "b", body: "x" }, deps).urgent).toBeUndefined();
  });
});

describe("SwitchboardStore", () => {
  test("append stores messages and list returns them by ascending timestamp", async () => {
    const { store } = makeStore();

    await expect(store.append(msg({ id: "newer", ts: 200 }))).resolves.toBe(true);
    await expect(store.append(msg({ id: "older", ts: 100 }))).resolves.toBe(true);

    const listed = await store.list();
    expect(listed).toHaveLength(2);
    expect(listed.map((item) => item.id)).toEqual(["older", "newer"]);
  });

  test("append returns false for duplicate ids without overwriting", async () => {
    const { store } = makeStore();

    await expect(store.append(msg({ id: "dup", body: "first" }))).resolves.toBe(true);
    await expect(store.append(msg({ id: "dup", body: "second" }))).resolves.toBe(false);

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].body).toBe("first");
  });

  test("list skips malformed json files", async () => {
    const { fs, store } = makeStore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await store.append(msg({ id: "good" }));
    fs.files.set(join(dir, "bad.json"), "{not json");

    await expect(store.list()).resolves.toEqual([msg({ id: "good" })]);
    expect(warn).toHaveBeenCalledOnce();

    warn.mockRestore();
  });

  test("inbox returns direct and broadcast messages only", async () => {
    const { store } = makeStore();

    await store.append(msg({ id: "direct", to: "cockpit", ts: 100 }));
    await store.append(msg({ id: "broadcast", to: "all", ts: 200 }));
    await store.append(msg({ id: "other", to: "design", ts: 300 }));

    expect((await store.inbox("cockpit")).map((item) => item.to)).toEqual(["cockpit", "all"]);
  });

  test("inbox unreadOnly returns only unread messages", async () => {
    const { store } = makeStore();

    await store.append(msg({ id: "read", to: "cockpit", ts: 100, read: true }));
    await store.append(msg({ id: "unread", to: "cockpit", ts: 200, read: false }));

    expect((await store.inbox("cockpit", { unreadOnly: true })).map((item) => item.id)).toEqual(["unread"]);
  });

  test("markRead flips one unread message and is idempotent for read and missing messages", async () => {
    const { store } = makeStore();

    await store.append(msg({ id: "target", read: false }));
    await expect(store.markRead("target")).resolves.toMatchObject({ id: "target", read: true });
    expect((await store.list()).find((item) => item.id === "target")?.read).toBe(true);

    await expect(store.markRead("missing")).resolves.toBeNull();
    await expect(store.markRead("target")).resolves.toMatchObject({ id: "target", read: true });
  });
});
