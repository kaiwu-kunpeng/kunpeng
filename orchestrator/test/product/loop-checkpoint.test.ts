import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { snapshotLoop, listCheckpoints, restoreCheckpoint } from "../../src/product/loop-checkpoint.js";

async function tmp(): Promise<string> { return mkdtemp(join(tmpdir(), "kp-ckpt-")); }
function loopDir(root: string, slug: string): string { return join(root, ".kunpeng", "product", slug); }

describe("loop-checkpoint", () => {
  it("snapshot 拷产物、list 倒序、restore 拷回，并记录 stage", async () => {
    const root = await tmp();
    const dir = loopDir(root, "p");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "spec.md"), "v1-spec", "utf8");
    await writeFile(join(dir, "state.json"), JSON.stringify({ currentStage: "spec" }), "utf8");
    const id1 = await snapshotLoop(root, "p", "存档1", 1000);
    // 改当前产物 + 推进阶段
    await writeFile(join(dir, "spec.md"), "v2-spec", "utf8");
    await writeFile(join(dir, "state.json"), JSON.stringify({ currentStage: "build" }), "utf8");
    const id2 = await snapshotLoop(root, "p", "存档2", 2000);

    const list = await listCheckpoints(root, "p");
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(id2);          // 倒序最新在前
    expect(list[0].label).toBe("存档2");
    expect(list[0].stage).toBe("build");   // 快照时读到的 currentStage
    expect(list[1].stage).toBe("spec");

    // 回滚到 id1（v1-spec），且会自动存当前(v2)→检查点变 3 个
    const ok = await restoreCheckpoint(root, "p", id1, 3000);
    expect(ok).toBe(true);
    expect(await readFile(join(dir, "spec.md"), "utf8")).toBe("v1-spec");
    expect((await listCheckpoints(root, "p")).length).toBe(3); // 含回滚前自动存
    await rm(root, { recursive: true, force: true });
  });

  it("旧格式 meta.json（无 stage）→ list 不炸、stage 为 undefined", async () => {
    const root = await tmp();
    const ckptDir = join(loopDir(root, "p"), ".checkpoints", "999");
    await mkdir(ckptDir, { recursive: true });
    // 手工造旧格式 meta：只有 id/ts/label，没有 stage
    await writeFile(join(ckptDir, "meta.json"), JSON.stringify({ id: "999", ts: 999, label: "旧" }), "utf8");
    const list = await listCheckpoints(root, "p");
    expect(list.length).toBe(1);
    expect(list[0].label).toBe("旧");
    expect(list[0].stage).toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });

  it("state.json 缺失/无 currentStage → 快照仍成功、stage 为 undefined", async () => {
    const root = await tmp();
    const dir = loopDir(root, "p");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "spec.md"), "s", "utf8");
    // 不写 state.json
    const id = await snapshotLoop(root, "p", "无state", 1000);
    const list = await listCheckpoints(root, "p");
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(id);
    expect(list[0].stage).toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });

  it("restore 不存在的 id → false", async () => {
    const root = await tmp();
    await mkdir(loopDir(root, "p"), { recursive: true });
    expect(await restoreCheckpoint(root, "p", "nope", 1)).toBe(false);
    await rm(root, { recursive: true, force: true });
  });

  it("无检查点目录 → list []", async () => {
    const root = await tmp();
    expect(await listCheckpoints(root, "missing")).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });
});