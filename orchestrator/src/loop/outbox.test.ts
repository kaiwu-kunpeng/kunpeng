import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { enqueueOutbox, flushOutbox, listOutbox } from "./outbox.js";

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), "kp-outbox-"));
}

describe("outbox store", () => {
  it("enqueue 写 pending 条目到 .kunpeng/outbox/<channel>.json 且 list 可读", () => {
    const repo = tmpRepo();
    const entry = enqueueOutbox(repo, "indexnow", { urls: ["https://x.com/a"], host: "x.com" });
    expect(entry.status).toBe("pending");
    expect(entry.channel).toBe("indexnow");
    const file = join(repo, ".kunpeng", "outbox", "indexnow.json");
    expect(existsSync(file)).toBe(true);
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(Array.isArray(onDisk)).toBe(true);
    expect(onDisk[0].payload.urls).toEqual(["https://x.com/a"]);
    const listed = listOutbox(repo, "indexnow");
    expect(listed.length).toBe(1);
    expect(listed[0].id).toBe(entry.id);
  });

  it("flush 逐条调 sender,成功标 flushed,失败保持 pending", async () => {
    const repo = tmpRepo();
    enqueueOutbox(repo, "indexnow", { urls: ["https://x.com/a"] });
    enqueueOutbox(repo, "indexnow", { urls: ["https://x.com/b"] });
    let calls = 0;
    const result = await flushOutbox(repo, "indexnow", async () => {
      calls += 1;
      return calls === 1; // 第一条成功,第二条失败
    });
    expect(calls).toBe(2);
    expect(result.flushed).toBe(1);
    expect(result.failed).toBe(1);
    expect(listOutbox(repo, "indexnow").length).toBe(1);
    expect(listOutbox(repo, "indexnow", { includeFlushed: true }).length).toBe(2);
    const flushedEntry = listOutbox(repo, "indexnow", { includeFlushed: true }).find(
      (e) => e.status === "flushed",
    );
    expect(flushedEntry?.flushedAt).toBeTruthy();
  });

  it("list 不传 channel 聚合全部;空仓返回空数组", () => {
    const repo = tmpRepo();
    expect(listOutbox(repo)).toEqual([]);
    enqueueOutbox(repo, "indexnow", { urls: ["https://x.com/a"] });
    enqueueOutbox(repo, "other", { urls: ["https://x.com/c"] });
    expect(listOutbox(repo).length).toBe(2);
  });
});