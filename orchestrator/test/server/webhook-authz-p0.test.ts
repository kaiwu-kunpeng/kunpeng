import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { handleTelegramWebhook } from "../../src/server/tg-webhook.js";
import { decideWebhookAuth } from "../../src/server/auth.js";

function setup(notify: Record<string, unknown>) {
  const prevHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), "kp-wh-p0-"));
  const stateDir = join(home, ".kunpeng");
  const repo = mkdtempSync(join(tmpdir(), "kp-wh-p0-repo-"));
  mkdirSync(join(repo, ".kunpeng", "state"), { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "projects.json"), JSON.stringify({ projects: [{ id: "p", name: "p", repoPath: repo, registeredAt: 1 }] }));
  writeFileSync(join(stateDir, "notify.json"), JSON.stringify({ telegram: notify }));
  const fid = "flow-p0";
  writeFileSync(join(repo, ".kunpeng", "state", `${fid}.json`), JSON.stringify({ flowId: fid, requirement: "x", stage: "done", status: "verified", agentActive: false, humanGate: { gate: "合并主干 (人工门#1)", what: `kp/${fid} → main` }, startedAt: 1, updatedAt: 1, history: [] }));
  process.env.HOME = home;
  return {
    stateDir, repo, fid,
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
  setTimeout(() => { r.emit("data", Buffer.from(body)); r.emit("end"); }, 40);
  return r as never;
}
function mkRes() { return { statusCode: 0, setHeader() {}, end() {} } as never; }

describe("webhook 鉴权收紧 P0", () => {
  it("未配 webhookSecret → 401 且不合并(humanGate 保留)", async () => {
    const s = setup({ token: "TK", chatId: "42" }); // 无 webhookSecret
    try {
      const res = { statusCode: 0, setHeader() {}, end() {} };
      const upd = JSON.stringify({ callback_query: { id: "c", data: `kpapprove:${s.fid}`, from: { id: 42 } } });
      await handleTelegramWebhook(mkReq({}, upd), res as never, s.stateDir, async () => ({}));
      expect(res.statusCode).toBe(401);
      const after = JSON.parse(readFileSync(join(s.repo, ".kunpeng", "state", `${s.fid}.json`), "utf8"));
      expect(after.humanGate == null).toBe(false); // 门仍在 = 未执行合并
    } finally { s.cleanup(); }
  }, 30_000);

  it("配了 secret 但未配 chatId → 不执行 approve(门保留)", async () => {
    const s = setup({ token: "TK", webhookSecret: "S3" }); // 无 chatId
    try {
      const upd = JSON.stringify({ callback_query: { id: "c", data: `kpapprove:${s.fid}`, from: { id: 42 } } });
      await handleTelegramWebhook(mkReq({ "x-telegram-bot-api-secret-token": "S3" }, upd), mkRes(), s.stateDir, async () => ({}));
      const after = JSON.parse(readFileSync(join(s.repo, ".kunpeng", "state", `${s.fid}.json`), "utf8"));
      expect(after.humanGate == null).toBe(false);
    } finally { s.cleanup(); }
  }, 30_000);

  it("decideWebhookAuth 语义正确", () => {
    expect(decideWebhookAuth({ configuredSecret: "abc", headerSecret: "abc", remoteIsLoopback: false })).toBe("allow");
    expect(decideWebhookAuth({ configuredSecret: "abc", headerSecret: "xyz", remoteIsLoopback: true })).toBe("deny");
    expect(decideWebhookAuth({ headerSecret: undefined, remoteIsLoopback: true })).toBe("allow");
    expect(decideWebhookAuth({ headerSecret: undefined, remoteIsLoopback: false })).toBe("deny");
  }, 30_000);
});