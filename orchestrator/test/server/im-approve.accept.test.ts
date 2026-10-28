import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyMergeGate, type NotifyConfig } from "../../src/runtime/notify.js";
import {
  IM_MAX_APPROVE_LEVEL, describeRedeemFailure, imApprovable, issueImTicket, newImTicketId, parseImReply, readImTickets, redeemImTicket,
} from "../../src/server/im-approve.js";
import { handleTelegramWebhook, setTelegramWebhook } from "../../src/server/tg-webhook.js";

// 背景（2026-10-03 运营审计 K4，总报告 P1-5；Codex #6 / Claude B4）：Telegram 直批按钮只校验 chatId，回调可重放、无时效，
// 任何等级的门都能一键批准。本测试锁定：每个待批门发一张一次性票（同流复用未用票）；按钮与文本回复 `yes <id>` 都凭票，
// 先到先用、过期失效；IM 入口封顶 L2——L3/L4 的票 approve 不消费直接拒、reject 照常；老按钮（无票）仍兼容；webhook 订阅 message。

function fakeFetch(answers: string[] = []) {
  const calls: Array<{ url: string; body: string }> = [];
  const fetchFn = (async (url: string, init?: { body?: string }) => { calls.push({ url, body: init?.body ?? "" }); return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "" }; }) as never;
  return { fetchFn, calls, answers };
}

describe("一次性票据（作者锁定）", () => {
  let stateDir: string;
  afterEach(() => { rmSync(stateDir, { recursive: true, force: true }); });

  it("签发：同流复用未用未过期的票；id 6 位；兑票先到先用；过期/未知/已用各有原因", async () => {
    stateDir = mkdtempSync(join(tmpdir(), "kp-im-"));
    expect(newImTicketId()).toMatch(/^[a-z2-9]{6}$/);
    const a = await issueImTicket(stateDir, { flowId: "f1", level: "L2", now: 1_000 });
    const again = await issueImTicket(stateDir, { flowId: "f1", level: "L2", now: 2_000 });
    expect(again.id).toBe(a.id);
    const b = await issueImTicket(stateDir, { flowId: "f2", level: "L2", now: 1_000, ttlMs: 10 });
    expect(b.id).not.toBe(a.id);
    expect(await redeemImTicket(stateDir, "zzzzzz", { by: "tg:42", outcome: "approve", now: 3_000 })).toEqual({ ok: false, reason: "unknown" });
    expect((await redeemImTicket(stateDir, b.id, { by: "tg:42", outcome: "approve", now: 3_000 })).ok === false && "expired").toBe("expired");
    const first = await redeemImTicket(stateDir, a.id, { by: "tg:42", outcome: "approve", now: 3_000 });
    expect(first).toMatchObject({ ok: true, ticket: { id: a.id, usedAt: 3_000, usedBy: "tg:42", outcome: "approve" } });
    const second = await redeemImTicket(stateDir, a.id, { by: "tg:43", outcome: "reject", now: 3_001 });
    expect(second).toMatchObject({ ok: false, reason: "used" });
    expect(describeRedeemFailure(second as never)).toContain("先到先用");
    expect((await readImTickets(stateDir)).find((t) => t.id === a.id)?.usedAt).toBe(3_000);
    const fresh = await issueImTicket(stateDir, { flowId: "f1", level: "L2", now: 4_000 });
    expect(fresh.id).not.toBe(a.id);
  });

  it("IM 封顶 L2：L3/L4 的票 approve 被拒且不消费，reject 可以；parseImReply 只认 yes/no + 6 位 id", async () => {
    stateDir = mkdtempSync(join(tmpdir(), "kp-im-cap-"));
    expect(IM_MAX_APPROVE_LEVEL).toBe("L2");
    expect(["L0", "L1", "L2", "L3", "L4"].map((l) => imApprovable(l as "L0"))).toEqual([true, true, true, false, false]);
    const t = await issueImTicket(stateDir, { flowId: "f3", level: "L3", now: 1_000 });
    const capped = await redeemImTicket(stateDir, t.id, { by: "tg:42", outcome: "approve", now: 2_000 });
    expect(capped).toMatchObject({ ok: false, reason: "level-capped" });
    expect(describeRedeemFailure(capped as never)).toContain("须在驾驶舱批准");
    expect((await readImTickets(stateDir))[0]?.usedAt).toBeUndefined();
    expect((await redeemImTicket(stateDir, t.id, { by: "tg:42", outcome: "reject", now: 2_000 })).ok).toBe(true);
    expect(parseImReply("yes abc234")).toEqual({ outcome: "approve", id: "abc234" });
    expect(parseImReply("  NO  ABC234 ")).toEqual({ outcome: "reject", id: "abc234" });
    expect(parseImReply("批准 abc234")).toEqual({ outcome: "approve", id: "abc234" });
    expect(parseImReply("yes abc")).toBeUndefined();
    expect(parseImReply("merge it")).toBeUndefined();
  });
});

describe("通知带票（作者锁定）", () => {
  const cfg: NotifyConfig = { telegram: { token: "T", chatId: "42" }, cockpitUrl: "https://c.example" };
  function keyboard(body: string): Array<Array<{ text: string; callback_data?: string }>> {
    return (JSON.parse(body) as { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> } }).reply_markup.inline_keyboard;
  }
  it("带票 L2：两键都带 :<票>，正文含「也可回复 yes <票> / no <票>」；L3：无批准键、正文说明只能拒绝；不带选项时回调与旧格式逐字相同", async () => {
    const f1 = fakeFetch();
    await notifyMergeGate("flow-1", "kp/flow-1 → main", cfg, f1.fetchFn, { ticket: "abc234", level: "L2" });
    expect(keyboard(f1.calls[0]!.body)[0]!.map((b) => b.callback_data)).toEqual(["kpapprove:flow-1:abc234", "kpreject:flow-1:abc234"]);
    expect((JSON.parse(f1.calls[0]!.body) as { text: string }).text).toContain("也可回复 yes abc234 / no abc234");
    const f3 = fakeFetch();
    await notifyMergeGate("flow-3", "w", cfg, f3.fetchFn, { ticket: "def567", level: "L3" });
    expect(keyboard(f3.calls[0]!.body)[0]!.map((b) => b.callback_data)).toEqual(["kpreject:flow-3:def567"]);
    expect((JSON.parse(f3.calls[0]!.body) as { text: string }).text).toContain("该门为 L3，IM 入口只能拒绝");
    const legacy = fakeFetch();
    await notifyMergeGate("flow-9", "w", cfg, legacy.fetchFn);
    expect(keyboard(legacy.calls[0]!.body)[0]!.map((b) => b.callback_data)).toEqual(["kpapprove:flow-9", "kpreject:flow-9"]);
    const hook = fakeFetch();
    await setTelegramWebhook("T", "https://c.example/", "S", hook.fetchFn);
    expect(JSON.parse(hook.calls[0]!.body)).toMatchObject({ allowed_updates: ["callback_query", "message"] });
  });
});

describe("webhook 凭票处置（作者锁定）", () => {
  function setup() {
    const prevHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "kp-im-wh-"));
    const stateDir = join(home, ".kunpeng");
    const repo = mkdtempSync(join(tmpdir(), "kp-im-wh-repo-"));
    mkdirSync(join(repo, ".kunpeng", "state"), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "projects.json"), JSON.stringify({ projects: [{ id: "p", name: "p", repoPath: repo, registeredAt: 1 }] }));
    writeFileSync(join(stateDir, "notify.json"), JSON.stringify({ telegram: { token: "TK", chatId: "42", webhookSecret: "S3" } }));
    const gate = (fid: string) => writeFileSync(join(repo, ".kunpeng", "state", `${fid}.json`), JSON.stringify({ flowId: fid, requirement: "x", stage: "done", status: "verified", agentActive: false, humanGate: { gate: "合并主干 (人工门#1)", what: `kp/${fid} → main` }, history: [], createdAt: 1, updatedAt: 1 }));
    gate("flow-a"); gate("flow-b");
    process.env.HOME = home;
    const hasGate = (fid: string) => (JSON.parse(readFileSync(join(repo, ".kunpeng", "state", `${fid}.json`), "utf8")) as { humanGate?: unknown }).humanGate != null;
    return { stateDir, repo, hasGate, cleanup: () => { if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome; rmSync(home, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); } };
  }
  function mkReq(body: string) {
    const r = new EventEmitter() as EventEmitter & { headers: Record<string, string> };
    r.headers = { "x-telegram-bot-api-secret-token": "S3" };
    setTimeout(() => { r.emit("data", Buffer.from(body)); r.emit("end"); }, 20);
    return r as never;
  }
  const mkRes = () => ({ statusCode: 0, setHeader() {}, end() {} } as never);
  const callback = (data: string, from = 42) => JSON.stringify({ callback_query: { id: "c", data, from: { id: from }, message: { chat: { id: 42 }, message_id: 7 } } });
  const text = (t: string, from = 42) => JSON.stringify({ message: { text: t, from: { id: from }, chat: { id: 42 } } });

  it("带票按钮拒绝 → 清门 + 票用掉；同票再来 → 「已使用」且不再动门；票与流不符 → 拒绝执行；老按钮无票仍可拒绝", async () => {
    const s = setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const t = await issueImTicket(s.stateDir, { flowId: "flow-a", level: "L2", now: Date.now() });
      const f = fakeFetch();
      await handleTelegramWebhook(mkReq(callback(`kpreject:flow-a:${t.id}`)), mkRes(), s.stateDir, f.fetchFn);
      expect(s.hasGate("flow-a")).toBe(false);
      expect((await readImTickets(s.stateDir))[0]).toMatchObject({ usedBy: "telegram:42", outcome: "reject" });
      const again = fakeFetch();
      await handleTelegramWebhook(mkReq(callback(`kpapprove:flow-a:${t.id}`)), mkRes(), s.stateDir, again.fetchFn);
      expect(again.calls.some((c) => c.url.endsWith("answerCallbackQuery") && c.body.includes("已被使用"))).toBe(true);
      const tb = await issueImTicket(s.stateDir, { flowId: "flow-b", level: "L2", now: Date.now() });
      const mismatch = fakeFetch();
      await handleTelegramWebhook(mkReq(callback(`kpreject:flow-a:${tb.id}`)), mkRes(), s.stateDir, mismatch.fetchFn);
      expect(mismatch.calls.some((c) => c.body.includes("不属于流 flow-a"))).toBe(true);
      expect(s.hasGate("flow-b")).toBe(true);
      const legacy = fakeFetch();
      await handleTelegramWebhook(mkReq(callback("kpreject:flow-b")), mkRes(), s.stateDir, legacy.fetchFn);
      expect(s.hasGate("flow-b")).toBe(false);
    } finally { vi.restoreAllMocks(); s.cleanup(); }
  });

  it("文本回复：本人 `no <票>` 清门并 sendMessage 回报；外人同文本被忽略；L3 票 `yes` 被封顶拒绝且门仍在", async () => {
    const s = setup();
    try {
      const t = await issueImTicket(s.stateDir, { flowId: "flow-a", level: "L2", now: Date.now() });
      const stranger = fakeFetch();
      await handleTelegramWebhook(mkReq(text(`no ${t.id}`, 999)), mkRes(), s.stateDir, stranger.fetchFn);
      expect(stranger.calls).toEqual([]);
      expect(s.hasGate("flow-a")).toBe(true);
      const mine = fakeFetch();
      await handleTelegramWebhook(mkReq(text(`no ${t.id}`)), mkRes(), s.stateDir, mine.fetchFn);
      expect(s.hasGate("flow-a")).toBe(false);
      expect(mine.calls.some((c) => c.url.endsWith("sendMessage") && c.body.includes("已拒绝 flow-a"))).toBe(true);
      const t3 = await issueImTicket(s.stateDir, { flowId: "flow-b", level: "L3", now: Date.now() });
      const capped = fakeFetch();
      await handleTelegramWebhook(mkReq(text(`yes ${t3.id}`)), mkRes(), s.stateDir, capped.fetchFn);
      expect(capped.calls.some((c) => c.url.endsWith("sendMessage") && c.body.includes("须在驾驶舱批准"))).toBe(true);
      expect(s.hasGate("flow-b")).toBe(true);
      const chatter = fakeFetch();
      await handleTelegramWebhook(mkReq(text("早上好")), mkRes(), s.stateDir, chatter.fetchFn);
      expect(chatter.calls).toEqual([]);
    } finally { s.cleanup(); }
  });
});