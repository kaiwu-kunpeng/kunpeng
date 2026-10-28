import { expect, test, vi } from "vitest";
import { runCapture } from "../../src/knowledge/capture-cli.js";
import { CaptureStore, type FileSystem } from "../../src/knowledge/capture-store.js";
import { extractUrl } from "../../src/knowledge/ingest.js";

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

test("runCapture captures URL raw through fetchUrl and uses summarize override", async () => {
  const store = new CaptureStore("/captures", new MemoryFs());
  const fetchUrl = vi.fn(async () => "网页正文ABC");
  const summarize = vi.fn(async (raw: string) => ({
    summary: `S:${raw.slice(0, 3)}`,
    tags: ["t1", "t1", "t2"],
  }));

  const capture = await runCapture(
    { kind: "url", value: "https://x.test/a" },
    {
      store,
      fetchUrl,
      readFile: vi.fn(async () => "unused"),
      now: () => 1,
      newId: () => "cap-u",
      summarize,
    },
  );

  expect(fetchUrl).toHaveBeenCalledWith("https://x.test/a");
  expect(summarize).toHaveBeenCalledWith("网页正文ABC");
  expect(capture.source).toBe("url");
  expect(capture.raw).toBe("网页正文ABC");
  expect(capture.summary).toBe("S:网页正");
  expect(capture.tags).toEqual(["t1", "t2"]);

  await expect(store.listCaptures()).resolves.toEqual([capture]);
});

test("extractUrl pulls the first clean URL out of noisy Toutiao share text", () => {
  const shared = "今日头条分享给你 🚀 https://m.toutiao.com/is/ePHRA-lNBZM/ ePHRA-lNBZM` eRk:/ q@e.Ox :9am 复制此条消息...";

  expect(extractUrl(shared)).toBe("https://m.toutiao.com/is/ePHRA-lNBZM/");
});

test("runCapture rejects URL input without a legal URL and does not append capture", async () => {
  const store = new CaptureStore("/captures", new MemoryFs());
  const fetchUrl = vi.fn(async () => "unused");

  await expect(
    runCapture(
      { kind: "url", value: "今日头条分享文案但没有链接" },
      {
        store,
        fetchUrl,
        readFile: vi.fn(async () => "unused"),
        now: () => 1,
        newId: () => "cap-bad-url",
      },
    ),
  ).rejects.toThrow(/合法 http\(s\) URL/);

  expect(fetchUrl).not.toHaveBeenCalled();
  await expect(store.listCaptures()).resolves.toEqual([]);
});

test("runCapture does not append a capture when URL fetch fails", async () => {
  const store = new CaptureStore("/captures", new MemoryFs());
  const fetchUrl = vi.fn(async () => {
    throw new Error("Error: [{\"validation\":\"url\",\"message\":\"Invalid url\"}]");
  });

  await expect(
    runCapture(
      { kind: "url", value: "https://m.toutiao.com/is/ePHRA-lNBZM/" },
      {
        store,
        fetchUrl,
        readFile: vi.fn(async () => "unused"),
        now: () => 1,
        newId: () => "cap-fetch-fail",
      },
    ),
  ).rejects.toThrow(/Invalid url/);

  await expect(store.listCaptures()).resolves.toEqual([]);
});
