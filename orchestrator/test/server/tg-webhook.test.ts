import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { handleTelegramWebhook } from "../../src/server/tg-webhook.js";

function setup() {
  const prevHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), "kp-tgwh-"));
  const stateDir = join(home, ".kunpeng");
  const repo = mkdtempSync(join(tmpdir(), "kp-tgwh-repo-"));
  mkdirSync(join(repo, ".kunpeng", "state"), { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "projects.json"), JSON.stringify({ projects: [{ id: "p", name: "p", repoPath: repo, registeredAt: 1 }] }));
  writeFileSync(join(stateDir, "notify.json"), JSON.stringify({ telegram: { token: "TK", chatId: "42", webhookSecret: "S3" } }));
  const fid = "flow-zz";
  writeFileSync(join(repo, ".kunpeng", "state", `${fid}.json`), JSON.stringify({ flowId: fid, requirement: "x", stage: "done", status: "verified", agentActive: false, humanGate: { gate: "合并主干 (人工门#1)", what: `kp/${fid} → main` }, startedAt: 1, updatedAt: 1, history: [] }));
  process.env.HOME = home;
  return {
    home, stateDir, repo, fid,
    cleanup: () => {
      if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    },
  };
}
function mkReq(headers: Record<string, string>, body: string) {
  const r = new EventEmitter() as EventEmitter & { headers: Record<string, string> };
  r.headers = headers;
  setTimeout(() => { r.emit("data", Buffer.from(body)); r.emit("end"); }, 60);
  return r as never;
}
function mkRes() { return { statusCode: 0, setHeader() {}, end() {} } as never; }

describe("handleTelegramWebhook", () => {
  it("错 secret → 401", async () => {
    const s = setup();
    try {
      const res = { statusCode: 0, setHeader() {}, end() {} };
      const upd = JSON.stringify({ callback_query: { id: "c", data: `kpreject:${s.fid}`, from: { id: 42 } } });
      await handleTelegramWebhook(mkReq({ "x-telegram-bot-api-secret-token": "WRONG" }, upd), res as never, s.stateDir, async () => ({}));
      expect(res.statusCode).toBe(401);
    } finally { s.cleanup(); }
  }, 30_000);

  it("正确 secret+chatId 的 kpreject → 清门 + 回 answerCallbackQuery", async () => {
    const s = setup();
    try {
      const calls: string[] = [];
      const fake = async (url: string) => { calls.push(url); return {}; };
      const upd = JSON.stringify({ callback_query: { id: "c", data: `kpreject:${s.fid}`, from: { id: 42 }, message: { chat: { id: 42 }, message_id: 1 } } });
      await handleTelegramWebhook(mkReq({ "x-telegram-bot-api-secret-token": "S3" }, upd), mkRes(), s.stateDir, fake);
      const after = JSON.parse(readFileSync(join(s.repo, ".kunpeng", "state", `${s.fid}.json`), "utf8"));
      expect(after.humanGate == null).toBe(true);
      expect(calls.some((u) => u.includes("answerCallbackQuery"))).toBe(true);
    } finally { s.cleanup(); }
  }, 30_000);

  it("错 chatId → 回包含『无权』", async () => {
    const s = setup();
    try {
      const bodies: string[] = [];
      const fake = async (_u: string, i?: { body?: string }) => { bodies.push(i?.body ?? ""); return {}; };
      const upd = JSON.stringify({ callback_query: { id: "c", data: `kpreject:${s.fid}`, from: { id: 999 } } });
      await handleTelegramWebhook(mkReq({ "x-telegram-bot-api-secret-token": "S3" }, upd), mkRes(), s.stateDir, fake);
      expect(bodies.some((b) => b.includes("无权"))).toBe(true);
    } finally { s.cleanup(); }
  }, 30_000);
});