import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore, summarizeParseError } from "../../src/artifacts/store.js";
import { Artifact } from "../../src/artifacts/types.js";

let dir: string;
let store: ArtifactStore;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "kp-art-warn-"));
  store = new ArtifactStore(dir);
  await store.write({ kind: "spec", id: "a1", status: "draft", body: "正文", meta: {} });
  // 一个没有 frontmatter 的普通 markdown,混进了 artifacts 目录(线上真实形态)
  writeFileSync(join(dir, "plain-note.md"), "# 只是一篇笔记\n\n正文\n");
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

describe("artifact 清单跳过坏文件:只告警一次、单行(作者锁定)", () => {
  it("坏文件被跳过,好文件照常返回,且连续两次 list 只告警一次", async () => {
    const first = await store.list();
    const second = await store.list();
    expect(first.map((a) => a.id)).toEqual(["a1"]);
    expect(second.map((a) => a.id)).toEqual(["a1"]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("告警是单行,点名文件与缺失字段,并说明只提示一次", async () => {
    await store.list();
    const msg = String(errorSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("plain-note.md");
    expect(msg).toContain("kind");
    expect(msg).toContain("status");
    expect(msg).toContain("只提示一次");
    expect(msg).not.toContain("\n");
    expect(msg.length).toBeLessThan(600);
  });

  it("文件修好后再次损坏,会重新告警一次", async () => {
    await store.list();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    writeFileSync(join(dir, "plain-note.md"), "---\nkind: spec\nid: plain-note\nstatus: draft\n---\n正文\n");
    expect((await store.list()).map((a) => a.id).sort()).toEqual(["a1", "plain-note"]);
    writeFileSync(join(dir, "plain-note.md"), "# 又坏了\n");
    await store.list();
    await store.list();
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it("summarizeParseError:ZodError 折成一行的 path: message 列表", () => {
    const r = Artifact.safeParse({});
    expect(r.success).toBe(false);
    const s = summarizeParseError(r.success ? null : r.error);
    expect(s).not.toContain("\n");
    expect(s).toContain("kind: Required");
    expect(s).toContain("id: Required");
    expect(s).toContain("status: Required");
  });

  it("summarizeParseError:普通 Error 与非 Error 也折成单行", () => {
    expect(summarizeParseError(new Error("第一行\n第二行\r\n第三行"))).toBe("第一行 第二行 第三行");
    expect(summarizeParseError("裸字符串")).toBe("裸字符串");
    expect(summarizeParseError(42)).toBe("42");
  });
});
