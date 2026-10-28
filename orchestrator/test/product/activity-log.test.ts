import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { appendActivity, readActivity } from "../../src/product/activity-log.js";

async function tmp(): Promise<string> { return mkdtemp(join(tmpdir(), "kp-act-")); }

describe("product activity-log", () => {
  it("append 后 read 倒序返回（最新在前）", async () => {
    const root = await tmp();
    await appendActivity(root, "p", { ts: 1, actor: "claude", kind: "agent.draft", summary: "起草 spec" });
    await appendActivity(root, "p", { ts: 2, actor: "admin", kind: "accept", summary: "接受 spec", stage: "spec" });
    const evs = await readActivity(root, "p");
    expect(evs.length).toBe(2);
    expect(evs[0].summary).toBe("接受 spec");
    expect(evs[0].stage).toBe("spec");
    expect(evs[1].actor).toBe("claude");
    await rm(root, { recursive: true, force: true });
  });

  it("limit 截断", async () => {
    const root = await tmp();
    for (let i = 0; i < 5; i++) await appendActivity(root, "p", { ts: i, actor: "a", kind: "k", summary: "e" + i });
    expect((await readActivity(root, "p", 3)).length).toBe(3);
    await rm(root, { recursive: true, force: true });
  });

  it("坏行跳过、缺文件返回 []", async () => {
    const root = await tmp();
    expect(await readActivity(root, "missing")).toEqual([]);
    const dir = join(root, ".kunpeng", "product", "p");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "activity.jsonl"), '{"ts":1,"actor":"a","kind":"k","summary":"ok"}\n坏行不是json\n', "utf8");
    const evs = await readActivity(root, "p");
    expect(evs.length).toBe(1);
    expect(evs[0].summary).toBe("ok");
    await rm(root, { recursive: true, force: true });
  });
});