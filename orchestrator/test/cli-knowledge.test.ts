import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { heuristicSummarize } from "../src/knowledge/capture-cli.js";
import { CaptureStore, type Capture } from "../src/knowledge/capture-store.js";
import { promote } from "../src/knowledge/promote.js";
import { recall } from "../src/knowledge/recall.js";
import "../src/cli-commands/knowledge.js";
import { listCliCommands } from "../src/cli-commands/registry.js";
import { cliSource } from "./helpers/cli-source.js";

const tempDirs: string[] = [];

function capture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: "cap-1",
    source: "text",
    kind: "note",
    raw: "Capture recall wiring stores widget evidence for later promotion.",
    tags: ["widget"],
    citedFrom: "cli-test-source",
    createdAt: 100,
    promoted: false,
    ...overrides,
  };
}

async function makeStore(): Promise<CaptureStore> {
  const dir = await mkdtemp(join(tmpdir(), "kunpeng-cli-knowledge-"));
  tempDirs.push(dir);
  return new CaptureStore(join(dir, ".kunpeng", "captures"));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("knowledge CLI wiring", () => {
  test("recall uses CaptureStore listCaptures and returns source, snippet, and capture id", async () => {
    const store = await makeStore();
    const item = capture();
    await store.appendCapture(item);

    const hits = await recall(
      "widget",
      { listCaptures: () => store.listCaptures() },
      { limit: 1 },
    );

    expect(hits).toHaveLength(1);
    expect(hits[0].capture.id).toBe(item.id);
    expect(hits[0].citation.source).toBe("cli-test-source");
    expect(hits[0].citation.snippet).toContain("widget evidence");
  });

  test("promote uses CaptureStore promoteCapture and persists promoted=true", async () => {
    const store = await makeStore();
    const item = capture({ id: "cap-promote" });
    await store.appendCapture(item);

    const result = await promote(item.id, {
      promoteCapture: (id) => store.promoteCapture(id),
    });

    expect(result?.capture.promoted).toBe(true);
    await expect(store.listCaptures()).resolves.toEqual([{ ...item, promoted: true }]);
  });

  test("promote returns null for missing captures", async () => {
    const store = await makeStore();

    await expect(promote("missing", {
      promoteCapture: (id) => store.promoteCapture(id),
    })).resolves.toBeNull();
  });

  test("promote enrich wiring reuses deterministic heuristic summary", async () => {
    const store = await makeStore();
    const item = capture({
      id: "cap-enrich",
      raw: "Knowledge capture capture promotes durable signals. Durable signals help recall.",
    });
    await store.appendCapture(item);

    const result = await promote(item.id, {
      promoteCapture: (id) => store.promoteCapture(id),
      enrich: async (raw) => heuristicSummarize(raw),
    });

    expect(result?.enriched).toEqual({
      summary: "Knowledge capture capture promotes durable signals",
      tags: ["capture", "durable", "signals", "knowledge", "promotes"],
    });
  });

  test("cli dispatch text registers recall and promote commands", () => {
    const cliText = cliSource();
    const names = listCliCommands().map((command) => command.name);

    expect(names).toEqual(expect.arrayContaining(["capture", "kb", "recall", "promote"]));
    expect(cliText).toContain("命令: run | plan | product | merge | scope-check | gc | register | projects | capture | recall | promote");
  });
});
