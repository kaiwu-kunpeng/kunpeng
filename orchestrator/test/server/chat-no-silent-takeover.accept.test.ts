import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { chatRunKey, createChatRun } from "../../src/server/chat-run-bus.js";
import { handleWorkspaceRoute, type WorkspaceRouteDeps } from "../../src/server/workspace-route.js";
import { clientScript } from "../../src/server/ui/client.js";

class FakeResponse extends EventEmitter {
  statusCode = 200;
  body = "";
  readonly headers = new Map<string, unknown>();
  setHeader(name: string, value: unknown): this { this.headers.set(name.toLowerCase(), value); return this; }
  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers ?? {})) this.setHeader(name, value);
    return this;
  }
  write(chunk: unknown): boolean { this.body += String(chunk); return true; }
  end(chunk?: unknown): this { if (chunk !== undefined) this.body += String(chunk); return this; }
}

function jsonRequest(body: unknown): IncomingMessage {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  Object.assign(req, { headers: { host: "cockpit.test", "sec-fetch-site": "same-origin" } });
  return req;
}

function response(): { raw: FakeResponse; res: ServerResponse } {
  const raw = new FakeResponse();
  return { raw, res: raw as unknown as ServerResponse };
}

function fakeSse(): ServerResponse {
  return { write: () => true, end: () => undefined, on: () => undefined } as unknown as ServerResponse;
}

/** 从 clientScript 里抠出内联的顶层函数(沿用 chat-failure-403.test.ts 的做法)。 */
function loadInline<T>(name: string): T {
  const at = clientScript.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`clientScript 里找不到内联的 ${name}`);
  let depth = 0;
  let started = false;
  let end = -1;
  for (let i = at; i < clientScript.length; i += 1) {
    const ch = clientScript[i];
    if (ch === "{") { depth += 1; started = true; }
    else if (ch === "}") { depth -= 1; if (started && depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error(`${name} 函数体括号不闭合`);
  return new Function(`${clientScript.slice(at, end)}; return ${name};`)() as T;
}

describe("同会话在跑时新消息不得静默掐掉旧 run（作者锁定）", () => {
  it("有活 run → POST /chat 返回 409、不起新流、旧 run 的 abort 不被触发；run 结束后同样的请求放行", async () => {
    const username = "owner-a";
    const conv = "conv-takeover-accept";
    const run = createChatRun(chatRunKey(username, conv));
    const aborted = vi.fn();
    run.bindAbort(aborted);
    const stream = vi.fn(async () => undefined);
    const deps: WorkspaceRouteDeps = {
      username,
      resolveCwd: async () => "/repos/kunpeng",
      streamChat: stream as unknown as NonNullable<WorkspaceRouteDeps["streamChat"]>,
    };
    const first = response();
    await handleWorkspaceRoute("POST", "/api/workspace/kunpeng/chat", jsonRequest({ message: "再来一条", conv, model: "claude-opus-5", mode: "act" }), first.res, deps);
    expect(first.raw.statusCode).toBe(409);
    expect(JSON.parse(first.raw.body)).toMatchObject({ error: "chat run in progress", conv });
    expect(stream).not.toHaveBeenCalled();
    expect(aborted).not.toHaveBeenCalled();
    expect(run.done).toBe(false);

    run.endRun();
    const second = response();
    await handleWorkspaceRoute("POST", "/api/workspace/kunpeng/chat", jsonRequest({ message: "再来一条", conv, model: "claude-opus-5", mode: "act" }), second.res, deps);
    expect(second.raw.statusCode).not.toBe(409);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(aborted).not.toHaveBeenCalled();
  });

  it("别的会话有活 run 不影响本会话；同会话在跑时先 /chat/stop 再发即放行", async () => {
    const username = "owner-b";
    const busy = createChatRun(chatRunKey(username, "conv-busy"));
    const busyAbort = vi.fn(() => busy.endRun());
    busy.bindAbort(busyAbort);
    const stream = vi.fn(async () => undefined);
    const deps: WorkspaceRouteDeps = {
      username,
      resolveCwd: async () => "/repos/kunpeng",
      streamChat: stream as unknown as NonNullable<WorkspaceRouteDeps["streamChat"]>,
    };
    const other = response();
    await handleWorkspaceRoute("POST", "/api/workspace/kunpeng/chat", jsonRequest({ message: "别的会话", conv: "conv-free", model: "claude-opus-5", mode: "act" }), other.res, deps);
    expect(other.raw.statusCode).not.toBe(409);
    expect(stream).toHaveBeenCalledTimes(1);

    const blocked = response();
    await handleWorkspaceRoute("POST", "/api/workspace/kunpeng/chat", jsonRequest({ message: "同会话", conv: "conv-busy", model: "claude-opus-5", mode: "act" }), blocked.res, deps);
    expect(blocked.raw.statusCode).toBe(409);

    const stop = response();
    await handleWorkspaceRoute("POST", "/api/workspace/kunpeng/chat/stop?conv=conv-busy", jsonRequest({}), stop.res, deps);
    expect(busyAbort).toHaveBeenCalledTimes(1);
    const after = response();
    await handleWorkspaceRoute("POST", "/api/workspace/kunpeng/chat", jsonRequest({ message: "同会话", conv: "conv-busy", model: "claude-opus-5", mode: "act" }), after.res, deps);
    expect(after.raw.statusCode).not.toBe(409);
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("createChatRun 接管旧 run 仍作兜底但要在 console 留痕", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const key = chatRunKey("owner-c", "conv-race");
      const old = createChatRun(key);
      const oldAbort = vi.fn();
      old.bindAbort(oldAbort);
      old.subscribe(fakeSse(), 0);
      createChatRun(key);
      expect(oldAbort).toHaveBeenCalledTimes(1);
      expect(old.done).toBe(true);
      expect(warn.mock.calls.some((call) => String(call[0]).includes("接管") && String(call[0]).includes(key))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

interface Actions { showError: (msg: string) => void; reconnect: () => void; finish: (errored: boolean) => void }
type Handle = (status: number, errorCode: string, actions: Actions) => void;

describe("前端：409 接回在跑的输出并明示消息未发出；发送键生成中需二次确认才停（作者锁定）", () => {
  it("clientScript 语法有效", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  it("kpChatFailureHandle(409)：提示「仍在生成中」「未发出」并走重连(attach)，不以错误收口", () => {
    const handle = loadInline<Handle>("kpChatFailureHandle");
    const actions = { showError: vi.fn(), reconnect: vi.fn(), finish: vi.fn() };
    handle(409, "chat run in progress", actions);
    expect(actions.showError).toHaveBeenCalledTimes(1);
    const msg = String(actions.showError.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("仍在生成中");
    expect(msg).toContain("未发出");
    expect(actions.reconnect).toHaveBeenCalledTimes(1);
    expect(actions.finish).not.toHaveBeenCalled();
  });

  it("403/401 行为不变：不重连、以错误收口", () => {
    const handle = loadInline<Handle>("kpChatFailureHandle");
    const a = { showError: vi.fn(), reconnect: vi.fn(), finish: vi.fn() };
    handle(401, "", a);
    expect(a.reconnect).not.toHaveBeenCalled();
    expect(a.finish).toHaveBeenCalledWith(true);
  });

  it("kpStopConfirm：第一次点只提示「再点一次」，1.5 秒内第二次才真停；超时后回到第一步", () => {
    const window = new Window();
    const stateEl = window.document.createElement("div");
    type Confirm = (state: { until: number; timer: unknown }, now: number, setState: (s: string) => void, stop: () => void, label: string, schedule: (fn: () => void, ms: number) => unknown, cancel: (t: unknown) => void) => { until: number; timer: unknown };
    const kpStopConfirm = loadInline<Confirm>("kpStopConfirm");
    const stop = vi.fn();
    const setState = (s: string) => { stateEl.textContent = s; };
    const timers: Array<() => void> = [];
    const schedule = (fn: () => void) => { timers.push(fn); return timers.length; };
    const cancel = vi.fn();
    let state = { until: 0, timer: null as unknown };
    state = kpStopConfirm(state, 1000, setState, stop, "再点一次停止本轮", schedule, cancel);
    expect(stop).not.toHaveBeenCalled();
    expect(stateEl.textContent).toBe("再点一次停止本轮");
    expect(state.until).toBe(2500);
    state = kpStopConfirm(state, 2000, setState, stop, "再点一次停止本轮", schedule, cancel);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(state.until).toBe(0);
    // 超时:第一次点后 1.5 秒内没有第二次 → 定时器把状态清回去,再点又是第一步
    state = kpStopConfirm(state, 5000, setState, stop, "再点一次停止本轮", schedule, cancel);
    expect(stop).toHaveBeenCalledTimes(1);
    for (const fn of timers.splice(0)) fn();
    const again = kpStopConfirm(state, 7000, setState, stop, "再点一次停止本轮", schedule, cancel);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(again.until).toBe(8500);
    expect(stateEl.textContent).toBe("再点一次停止本轮");
    window.close();
  });

  it("发送键与 Esc 都经 kpStopConfirm，不再一键 abort", () => {
    expect(clientScript).toContain('sendBtn.addEventListener("click", function () { if (cur) confirmStop("再点一次停止本轮"); else send(); });');
    expect(clientScript).not.toContain('sendBtn.addEventListener("click", function () { if (cur) abort(false); else send(); });');
    expect(clientScript).toContain('if (cur) confirmStop("再按一次 Esc 停止本轮"); else input.blur();');
    expect(clientScript).toContain("stopConfirmState = kpStopConfirm(stopConfirmState, Date.now(), setState, function () { abort(false); }, label, ");
  });
});