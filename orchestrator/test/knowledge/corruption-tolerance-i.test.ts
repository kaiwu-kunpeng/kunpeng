import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listLessons } from "../../src/knowledge/lesson-store.js";
import { listOutbox } from "../../src/loop/outbox.js";

function validLesson(id: string) {
  return { id, title: "t", description: "d", content: "c", polarity: "success", evidence: "e", sourceIds: ["s1"], trustTier: 1, stats: { injected: 0, wins: 0, losses: 0 }, createdAt: 1 };
}

describe("审计修复I 坏行/坏档容错", () => {
  it("lessons.jsonl 单坏行不清空整表", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "kp-lesson-i-"));
    try {
      mkdirSync(join(stateDir, "skills"), { recursive: true });
      const good = JSON.stringify(validLesson("l1"));
      writeFileSync(join(stateDir, "skills", "lessons.jsonl"), good + "\n{ this is broken\n");
      const lessons = await listLessons(stateDir);
      expect(lessons.map((l) => l.id)).toEqual(["l1"]);
    } finally { rmSync(stateDir, { recursive: true, force: true }); }
  });

  it("outbox 坏通道文件不崩", () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-outbox-i-"));
    try {
      mkdirSync(join(repo, ".kunpeng", "outbox"), { recursive: true });
      writeFileSync(join(repo, ".kunpeng", "outbox", "test.json"), "{ not an array");
      expect(listOutbox(repo, "test")).toEqual([]);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
});