import { describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CaptureStore,
  newCapture,
  type Capture,
  type FileSystem,
} from "../../src/knowledge/capture-store.js";

function capture(id: string, overrides: Partial<Capture> = {}): Capture {
  return {
    id,
    source: "text",
    kind: "note",
    raw: `raw ${id}`,
    tags: [],
    createdAt: 100,
    promoted: false,
    ...overrides,
  };
}

class MemoryFs implements FileSystem {
  readonly files = new Map<string, string>();
  writeCount = 0;

  access: FileSystem["access"] = async (path) => {
    if (typeof path !== "string") throw new Error("MemoryFs expects a string path");
    if (!this.files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };

  mkdir = (async () => undefined) as FileSystem["mkdir"];

  // Node overloads distinguish encoded text from a Buffer result.
  readFile = (async (...[path, options]: Parameters<FileSystem["readFile"]>) => {
    if (typeof path !== "string") throw new Error("MemoryFs expects a string path");
    const value = this.files.get(path);
    if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? Buffer.from(value).toString(encoding) : Buffer.from(value);
  }) as FileSystem["readFile"];

  readdir = (async (path: Parameters<FileSystem["readdir"]>[0], options?: BufferEncoding | "buffer" | { encoding?: BufferEncoding | "buffer" | null; withFileTypes?: boolean; recursive?: boolean } | null) => {
    if (typeof path !== "string") throw new Error("MemoryFs expects a string path");
    if (typeof options === "object" && options?.withFileTypes) throw new Error("MemoryFs does not model Dirents");
    if (options === "buffer" || (typeof options === "object" && options?.encoding === "buffer")) throw new Error("MemoryFs expects text directory entries");
    const prefix = path.endsWith("/") ? path : `${path}/`;
    return [...this.files.keys()]
      .filter((file) => file.startsWith(prefix))
      .map((file) => file.slice(prefix.length))
      .filter((file) => !file.includes("/"));
  }) as FileSystem["readdir"];

  writeFile: FileSystem["writeFile"] = async (path, data, options) => {
    if (typeof path !== "string") throw new Error("MemoryFs expects a string path");
    if (typeof data !== "string" && !ArrayBuffer.isView(data)) throw new Error("MemoryFs expects text or bytes");
    if (typeof options === "object" && options?.flag === "wx" && this.files.has(path)) {
      throw Object.assign(new Error("exists"), { code: "EEXIST" });
    }
    this.writeCount += 1;
    this.files.set(path, typeof data === "string" ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString());
  };

  unlink: FileSystem["unlink"] = async (path) => {
    if (typeof path !== "string") throw new Error("MemoryFs expects a string path");
    if (!this.files.delete(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };
}

describe("newCapture", () => {
  test("uses injected id/time and fills default fields", () => {
    const item = newCapture(
      { source: "url", kind: "signal", raw: "https://x" },
      { now: () => 1000, id: () => "cap-1" },
    );

    expect(item.id).toBe("cap-1");
    expect(item.createdAt).toBe(1000);
    expect(item.promoted).toBe(false);
    expect(item.tags).toEqual([]);
    expect(item.summary).toBeUndefined();
  });

  test("passes optional fields through unchanged", () => {
    const item = newCapture(
      {
        source: "chat",
        kind: "insight",
        raw: "hello",
        summary: "short",
        tags: ["a", "b"],
        projectId: "p1",
        citedFrom: "thread-1",
      },
      { now: () => 2000, id: () => "cap-2" },
    );

    expect(item).toMatchObject({
      id: "cap-2",
      createdAt: 2000,
      summary: "short",
      tags: ["a", "b"],
      projectId: "p1",
      citedFrom: "thread-1",
      promoted: false,
    });
  });
});

describe("CaptureStore", () => {
  test("appends different captures and lists them by deterministic filename order", async () => {
    const io = new MemoryFs();
    const store = new CaptureStore("/captures", io, null);
    const later = capture("b", { raw: "second", createdAt: 2 });
    const earlier = capture("a", { raw: "first", createdAt: 1 });

    await expect(store.appendCapture(later)).resolves.toBe(true);
    await expect(store.appendCapture(earlier)).resolves.toBe(true);

    const captures = await store.listCaptures();
    expect(captures).toEqual([earlier, later]);
  });

  test("returns false for duplicate ids and does not overwrite the original", async () => {
    const io = new MemoryFs();
    const store = new CaptureStore("/captures", io, null);
    const original = capture("same", { raw: "original" });
    const duplicate = capture("same", { raw: "changed" });

    await expect(store.appendCapture(original)).resolves.toBe(true);
    await expect(store.appendCapture(duplicate)).resolves.toBe(false);

    expect(await store.listCaptures()).toEqual([original]);
  });

  test("skips broken json files while listing", async () => {
    const io = new MemoryFs();
    const store = new CaptureStore("/captures", io, null);
    const good = capture("good");
    await store.appendCapture(good);
    io.files.set(join("/captures", "broken.json"), "{ broken");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(store.listCaptures()).resolves.toEqual([good]);
    expect(warn).toHaveBeenCalledWith("[capture-store] 跳过无法解析的文件: broken.json");
    warn.mockRestore();
  });

  test("promotes once, preserves original facts, is idempotent, and returns null for missing ids", async () => {
    const io = new MemoryFs();
    const store = new CaptureStore("/captures", io, null);
    const item = capture("cap/promote", { raw: "important", createdAt: 1234 });
    await store.appendCapture(item);
    const writesAfterAppend = io.writeCount;

    const promoted = await store.promoteCapture(item.id);
    expect(promoted).toMatchObject({
      id: item.id,
      raw: item.raw,
      createdAt: item.createdAt,
      promoted: true,
    });
    expect(await store.listCaptures()).toEqual([{ ...item, promoted: true }]);

    const writesAfterPromote = io.writeCount;
    await expect(store.promoteCapture(item.id)).resolves.toEqual({ ...item, promoted: true });
    expect(io.writeCount).toBe(writesAfterPromote);
    expect(writesAfterPromote).toBe(writesAfterAppend + 1);
    await expect(store.promoteCapture("nope")).resolves.toBeNull();
  });

  test("mirrors appended capture JSON into the injected shared knowledge pool", async () => {
    const root = await mkdtemp(join(tmpdir(), "kp-capture-mirror-"));
    try {
      const projectDir = join(root, "repo", ".kunpeng", "captures");
      const mirrorDir = join(root, "shared", "knowledge");
      const store = new CaptureStore(projectDir, undefined, mirrorDir);
      const item = capture("cap/mirror", { projectId: "project-a", raw: "persist me" });
      const fileName = `${encodeURIComponent(item.id)}.json`;

      await expect(store.appendCapture(item)).resolves.toBe(true);

      const projectJson = await readFile(join(projectDir, fileName), "utf8");
      const mirrorJson = await readFile(join(mirrorDir, fileName), "utf8");
      expect(mirrorJson).toBe(projectJson);
      expect(JSON.parse(mirrorJson)).toMatchObject({
        id: item.id,
        projectId: "project-a",
        raw: "persist me",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
