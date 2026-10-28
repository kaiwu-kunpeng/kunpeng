import { describe, expect, test, vi } from "vitest";
import { heuristicSummarize, runCapture } from "../../src/knowledge/capture-cli.js";
import { CaptureStore, type FileSystem } from "../../src/knowledge/capture-store.js";

class MemoryFs implements FileSystem {
  readonly files = new Map<string, string>();

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
    this.files.set(path, typeof data === "string" ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString());
  };

  unlink: FileSystem["unlink"] = async (path) => {
    if (typeof path !== "string") throw new Error("MemoryFs expects a string path");
    if (!this.files.delete(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };
}

function makeStore(): CaptureStore {
  return new CaptureStore("/captures", new MemoryFs());
}

describe("heuristicSummarize", () => {
  test("uses first sentence and deterministic top tags", () => {
    const result = heuristicSummarize(
      "The capture system stores capture signals. Capture signals help teams store context and capture insights.",
    );

    expect(result.summary).toBe("The capture system stores capture signals");
    expect(result.tags).toEqual(["capture", "signals", "system", "stores", "help"]);
    expect(result.tags.length).toBeLessThanOrEqual(5);
    expect(new Set(result.tags).size).toBe(result.tags.length);
  });

  test("accepts empty input", () => {
    expect(heuristicSummarize("")).toEqual({ summary: "", tags: [] });
  });
});

describe("runCapture", () => {
  test("captures text through ingest and appends the stored shape", async () => {
    const store = makeStore();
    const capture = await runCapture(
      { kind: "text", value: "Signal capture stores useful capture context.", projectId: "p1" },
      {
        store,
        fetchUrl: vi.fn(async () => "unused"),
        readFile: vi.fn(async () => "unused"),
        now: () => 1000,
        newId: () => "cap-x",
      },
    );

    expect(capture.id).toBe("cap-x");
    expect(capture.createdAt).toBe(1000);
    expect(capture.promoted).toBe(false);
    expect(capture.summary).toBe("Signal capture stores useful capture context");
    expect(capture.tags).toEqual(["capture", "signal", "stores", "useful", "context"]);
    expect(capture.projectId).toBe("p1");
    await expect(store.listCaptures()).resolves.toEqual([capture]);
  });

  test("captures URL content through injected fetchUrl", async () => {
    const store = makeStore();
    const fetchUrl = vi.fn(async () => "Fetched URL body. URL body becomes raw.");
    const capture = await runCapture(
      { kind: "url", value: "https://example.test/page" },
      {
        store,
        fetchUrl,
        readFile: vi.fn(async () => "unused"),
        now: () => 1000,
        newId: () => "cap-x",
      },
    );

    expect(fetchUrl).toHaveBeenCalledWith("https://example.test/page");
    expect(capture.raw).toBe("Fetched URL body. URL body becomes raw.");
    expect(capture.citedFrom).toBe("https://example.test/page");
    expect(capture.kind).toBe("url");
  });

  test("captures file content through injected readFile", async () => {
    const store = makeStore();
    const readFile = vi.fn(async () => "File body becomes raw.");
    const capture = await runCapture(
      { kind: "file", value: "/tmp/note.md" },
      {
        store,
        fetchUrl: vi.fn(async () => "unused"),
        readFile,
        now: () => 1000,
        newId: () => "cap-x",
      },
    );

    expect(readFile).toHaveBeenCalledWith("/tmp/note.md");
    expect(capture.raw).toBe("File body becomes raw.");
    expect(capture.citedFrom).toBe("/tmp/note.md");
    expect(capture.kind).toBe("file");
  });
});
