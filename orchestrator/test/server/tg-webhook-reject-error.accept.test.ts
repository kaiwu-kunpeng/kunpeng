import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleTelegramWebhook } from "../../src/server/tg-webhook.js";

const VALID = JSON.stringify({ flowId: "FID", requirement: "x", stage: "done", status: "verified", agentActive: false, humanGate: { gate: "合并主干 (人工门#1)", what: "kp/FID → main" }, startedAt: 1, updatedAt: 1, history: [] });

function setup(stateContent: string, readOnlyState = false) {
  const prevHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), "kp-tgrej-"));
  const stateDir = join(home, ".kunpeng");
  const repo = mkdtempSync(join(tmpdir(), "kp-tgrej-repo-"));
  mkdirSync(join(repo, ".kunpeng", "state"), { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "projects.json"), JSON.stringify({ projects: [{ id: "p", name: "p", repoPath: repo, registeredAt: 1 }] }));
  writeFileSync(join(stateDir, "notify.json"), JSON.stringify({ telegram: { token: "TK", chatId: "42", webhookSecret: "S3" } }));
  const fid = "flow-rej";
  writeFileSync(join(repo, ".kunpeng", "state", `${fid}.json`), stateContent.replaceAll("FID", fid));
  // 状态目录只读：流能被找到、读得出，但清门写回会失败（EACCES）。
  if (readOnlyState) chmodSync(join(repo, ".kunpeng", "state"), 0o555);
  process.env.HOME = home;
  return {
    stateDir, fid,
    cleanup: () => {
      if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
      chmodSync(join(repo, ".kunpeng", "state"), 0o755);
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    },
  };
}

function mkReq(body: string) {
  const r = new EventEmitter() as EventEmitter & { headers: Record<string, string> };
  r.headers = { "x-telegram-bot-api-secret-token": "S3" };
  setTimeout(() => { r.emit("data", Buffer.from(body)); r.emit("end"); }, 30);
  return r as never;
}
const mkRes = () => ({ statusCode: 0, setHeader() {}, end() {} }) as never;

async function reject(stateContent: string, readOnlyState = false) {
  const s = setup(stateContent, readOnlyState);
  const bodies: string[] = [];
  const fake = async (_url: string, init?: { body?: string }) => { bodies.push(init?.body ?? ""); return {}; };
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const upd = JSON.stringify({ callback_query: { id: "c", data: `kpreject:${s.fid}`, from: { id: 42 }, message: { chat: { id: 42 }, message_id: 1 } } });
    await handleTelegramWebhook(mkReq(upd), mkRes(), s.stateDir, fake);
    return { bodies, errors: errorSpy.mock.calls.map((args) => args.join(" ")) };
  } finally {
    errorSpy.mockRestore();
    s.cleanup();
  }
}

describe("Telegram 拒绝时清门失败不再静默（作者锁定）", () => {
  it("状态目录不可写导致清门失败 → 回复写明「拒绝失败」而不是「已拒绝」，并记 console.error", async () => {
    const { bodies, errors } = await reject(VALID, true);
    const answer = bodies.find((b) => b.includes("callback_query_id")) ?? "";
    expect(answer).toContain("拒绝失败");
    expect(answer).not.toContain("已拒绝");
    expect(bodies.some((b) => b.includes("editMessageText") || b.includes("拒绝失败"))).toBe(true);
    expect(errors.some((line) => line.includes("[tg-webhook]") && line.includes("flow-rej"))).toBe(true);
  }, 30_000);

  it("正常清门 → 仍回「已拒绝」，不记错误", async () => {
    const { bodies, errors } = await reject(VALID);
    expect(bodies.some((b) => b.includes("已拒绝"))).toBe(true);
    expect(errors.filter((line) => line.includes("[tg-webhook]"))).toEqual([]);
  }, 30_000);
});