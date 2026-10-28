import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendLesson, searchLessons, type LessonEntry } from "../../src/knowledge/lesson-store.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-lesson-trust-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function lesson(id: string, trustTier: 0 | 1 | 2): LessonEntry {
  return { id, title: `internal-links ${id}`, description: "d", content: "c", polarity: "failure", evidence: "e", sourceIds: ["s"], trustTier, stats: { injected: 0, wins: 0, losses: 0 }, createdAt: 1 };
}

describe("searchLessons 按信任分级过滤（作者锁定）", () => {
  it("默认排除 tier 0；minTrustTier=2 只留已验真；minTrustTier=0 全给", async () => {
    await appendLesson(dir, lesson("t0", 0));
    await appendLesson(dir, lesson("t1", 1));
    await appendLesson(dir, lesson("t2", 2));
    expect((await searchLessons(dir, "internal-links", 5)).map((l) => l.id).sort()).toEqual(["t1", "t2"]);
    expect((await searchLessons(dir, "internal-links", 5, { minTrustTier: 2 })).map((l) => l.id)).toEqual(["t2"]);
    expect((await searchLessons(dir, "internal-links", 5, { minTrustTier: 0 })).map((l) => l.id).sort()).toEqual(["t0", "t1", "t2"]);
  });

  it("运营波次决策器只吃 tier 2", () => {
    const text = readFileSync(fileURLToPath(new URL("../../src/loop/ops-pilot.ts", import.meta.url)), "utf8");
    expect(text).toMatch(/searchLessons\(stateDir,\s*lessonQuery,\s*2,\s*\{\s*minTrustTier:\s*2\s*\}\)/);
  });
});