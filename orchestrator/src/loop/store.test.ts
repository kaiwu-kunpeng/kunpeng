import * as fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LoopStore } from "./store.js";
import { LoopDefSchema, type LoopDef } from "./types.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-loop-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function sampleLoop(overrides: Partial<LoopDef> = {}): LoopDef {
  return {
    id: "loop-1",
    name: "Loop One",
    projectId: "project-1",
    recipe: "Improve the metric",
    metric: { key: "score", label: "Score", current: 0 },
    levers: [
      { id: "ship", label: "Ship", status: "active" },
      { id: "docs", label: "Docs", status: "needs-dev" },
    ],
    waves: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

test("create/read/list round-trips valid loops", async () => {
  const store = new LoopStore(dir);
  const loop = sampleLoop();

  await store.create(loop);

  expect(await store.read(loop.id)).toEqual(loop);
  expect(await store.list()).toEqual([loop]);
  await expect(fs.readFile(join(dir, `${loop.id}.json`), "utf8")).resolves.toContain("\n  \"id\": \"loop-1\"");
});

test("create throws on id conflict without overwriting", async () => {
  const store = new LoopStore(dir);
  const original = sampleLoop({ name: "Original" });
  await store.create(original);

  await expect(store.create(sampleLoop({ name: "Replacement" }))).rejects.toThrow(/already exists/);
  expect(await store.read("loop-1")).toEqual(original);
});

test("appendWave increments seq and syncs metric.current", async () => {
  const store = new LoopStore(dir);
  await store.create(sampleLoop({
    waves: [
      {
        seq: 3,
        at: 101,
        lever: "ship",
        subject: "previous",
        metricDelta: 2,
        metricAfter: 2,
        verified: true,
      },
    ],
  }));

  const appended = await store.appendWave("loop-1", {
    at: 102,
    lever: "docs",
    subject: "new docs",
    metricDelta: 5,
    metricAfter: 7,
    verified: false,
    gotchas: ["needs follow-up"],
  });

  expect(appended.seq).toBe(4);
  const loop = await store.read("loop-1");
  expect(loop?.waves.at(-1)).toEqual(appended);
  expect(loop?.metric.current).toBe(7);
  expect(loop?.updatedAt).toBeGreaterThan(100);
});

test("setNext and setLeverStatus update the loop", async () => {
  const store = new LoopStore(dir);
  await store.create(sampleLoop());

  await store.setNext("loop-1", { lever: "docs", target: "v2", note: "try content" });
  await store.setLeverStatus("loop-1", "docs", "honest-zero");

  const loop = await store.read("loop-1");
  expect(loop?.nextLever).toEqual({ lever: "docs", target: "v2", note: "try content" });
  expect(loop?.levers.find((lever) => lever.id === "docs")?.status).toBe("honest-zero");
  await expect(store.setLeverStatus("loop-1", "missing", "active")).rejects.toThrow(/lever not found/);
});

test("list skips corrupt JSON and schema-invalid files", async () => {
  const store = new LoopStore(dir);
  const valid = sampleLoop();
  await store.create(valid);
  await fs.writeFile(join(dir, "bad-json.json"), "{", "utf8");
  await fs.writeFile(join(dir, "bad-schema.json"), JSON.stringify({ id: "bad" }), "utf8");

  expect(await store.list()).toEqual([valid]);
});

test("read returns null for missing, corrupt, and schema-invalid loops", async () => {
  const store = new LoopStore(dir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, "corrupt.json"), "{", "utf8");
  await fs.writeFile(join(dir, "invalid.json"), JSON.stringify({ id: "invalid" }), "utf8");

  expect(await store.read("missing")).toBeNull();
  expect(await store.read("corrupt")).toBeNull();
  expect(await store.read("invalid")).toBeNull();
});

test("atomic write keeps existing target as complete valid JSON if rename fails", async () => {
  const store = new LoopStore(dir);
  const original = sampleLoop();
  await store.create(original);
  const target = join(dir, "loop-1.json");

  const failingRename = vi.fn<typeof fs.rename>().mockRejectedValueOnce(new Error("rename failed"));
  const failingStore = new LoopStore(dir, {
    access: fs.access,
    mkdir: fs.mkdir,
    readFile: fs.readFile,
    readdir: fs.readdir,
    rename: failingRename,
    unlink: fs.unlink,
    writeFile: fs.writeFile,
  });
  await expect(failingStore.appendWave("loop-1", {
    at: 200,
    lever: "ship",
    subject: "failed write",
    metricDelta: 10,
    metricAfter: 10,
    verified: true,
  })).rejects.toThrow(/rename failed/);

  const raw = await fs.readFile(target, "utf8");
  const parsed = LoopDefSchema.parse(JSON.parse(raw));
  expect(parsed).toEqual(original);
  expect(parsed.waves).toEqual([]);
  expect(parsed.metric.current).toBe(0);
});
