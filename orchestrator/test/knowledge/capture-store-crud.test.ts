import { describe, it, expect } from "vitest";
import { CaptureStore, type Capture, type FileSystem } from "../../src/knowledge/capture-store.js";

// 内存版 FileSystem:实现 CaptureStore 依赖的全部方法(含 unlink),确定性、零真实 IO。
function makeMemFs(seed: Record<string, string> = {}): FileSystem & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    files,
    access: async (p: Parameters<FileSystem["access"]>[0]) => {
      if (!files.has(String(p))) {
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        throw err;
      }
    },
    mkdir: async () => undefined,
    readFile: async (p: Parameters<FileSystem["readFile"]>[0]) => {
      const v = files.get(String(p));
      if (v === undefined) {
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        throw err;
      }
      return v;
    },
    readdir: async () => [...files.keys()].map((p) => p.split("/").pop()!),
    writeFile: async (
      p: Parameters<FileSystem["writeFile"]>[0],
      data: Parameters<FileSystem["writeFile"]>[1],
    ) => {
      files.set(String(p), String(data));
    },
    unlink: async (p: Parameters<FileSystem["unlink"]>[0]) => {
      if (!files.has(String(p))) {
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        throw err;
      }
      files.delete(String(p));
    },
  } as unknown as FileSystem & { files: Map<string, string> };
}

const baseCapture: Capture = {
  id: "cap-1",
  source: "text",
  kind: "note",
  raw: "原始正文",
  title: "旧标题",
  tags: ["a"],
  createdAt: 1000,
  promoted: false,
};

function seedFor(dir: string, cap: Capture): Record<string, string> {
  return { [`${dir}/${encodeURIComponent(cap.id)}.json`]: `${JSON.stringify(cap, null, 2)}\n` };
}

describe("CaptureStore 编辑/删除", () => {
  it("editCapture 合并白名单字段并持久化", async () => {
    const dir = "/store";
    const io = makeMemFs(seedFor(dir, baseCapture));
    const store = new CaptureStore(dir, io, null);

    const updated = await store.editCapture("cap-1", { title: "新标题", tags: ["x", "y"] });
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("新标题");
    expect(updated!.tags).toEqual(["x", "y"]);

    const list = await store.listCaptures();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("新标题");
  });

  it("editCapture 忽略不可变字段(id/source/raw/createdAt)", async () => {
    const dir = "/store";
    const io = makeMemFs(seedFor(dir, baseCapture));
    const store = new CaptureStore(dir, io, null);

    const unsafePatch = {
      title: "改了标题",
      id: "cap-HACK",
      raw: "被篡改的正文",
      createdAt: 9999,
    } as unknown as Parameters<CaptureStore["editCapture"]>[1];
    const updated = await store.editCapture("cap-1", unsafePatch);
    expect(updated!.id).toBe("cap-1");
    expect(updated!.raw).toBe("原始正文");
    expect(updated!.createdAt).toBe(1000);
    expect(updated!.title).toBe("改了标题");
  });

  it("editCapture 对不存在的 id 返回 null", async () => {
    const store = new CaptureStore("/store", makeMemFs(), null);
    expect(await store.editCapture("missing", { title: "x" })).toBeNull();
  });

  it("deleteCapture 删除存在的条目返回 true 且条目消失", async () => {
    const dir = "/store";
    const io = makeMemFs(seedFor(dir, baseCapture));
    const store = new CaptureStore(dir, io, null);

    expect(await store.deleteCapture("cap-1")).toBe(true);
    expect(await store.listCaptures()).toHaveLength(0);
  });

  it("deleteCapture 对不存在的 id 返回 false", async () => {
    const store = new CaptureStore("/store", makeMemFs(), null);
    expect(await store.deleteCapture("missing")).toBe(false);
  });
});
