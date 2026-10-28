import { describe, expect, test, vi } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

/** 从 clientScript 里抠出内联的顶层函数,独立 eval 后返回它(沿用 chat-reconnect-budget.test.ts 的做法)。 */
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

interface Actions {
  showError: (msg: string) => void;
  reconnect: () => void;
  finish: (errored: boolean) => void;
}
type Handle = (status: number, errorCode: string, actions: Actions) => void;

function spies() {
  return { showError: vi.fn(), reconnect: vi.fn(), finish: vi.fn() };
}

function firstMessage(a: ReturnType<typeof spies>): string {
  return String(a.showError.mock.calls[0]?.[0] ?? "");
}

describe("CHAT-403 对话流权限失败不再被静默吞掉", () => {
  test("clientScript 语法有效(防 SPA 静默崩)", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  test("kpChatFailureHandle 在顶层且无闭包依赖(可单独 eval)", () => {
    expect(() => loadInline<Handle>("kpChatFailureHandle")).not.toThrow();
  });

  test("403 act 越权:给含 Plan 的可操作提示、不重连、以错误收口", () => {
    const handle = loadInline<Handle>("kpChatFailureHandle");
    const a = spies();
    handle(403, "act mode requires owner role", a);
    expect(a.reconnect).not.toHaveBeenCalled();
    expect(a.showError).toHaveBeenCalledTimes(1);
    expect(firstMessage(a)).toContain("Plan");
    expect(firstMessage(a).length).toBeGreaterThan(8);
    // 只能传一个实参:第二个实参会触发会话重载,正是抹掉用户气泡的元凶
    expect(a.finish).toHaveBeenCalledWith(true);
  });

  test("403 项目未授权:另给一条提示,不得复用 Plan 那套说辞", () => {
    const handle = loadInline<Handle>("kpChatFailureHandle");
    const denied = spies();
    handle(403, "workspace is not authorized", denied);
    expect(denied.reconnect).not.toHaveBeenCalled();
    expect(denied.showError).toHaveBeenCalledTimes(1);
    expect(firstMessage(denied)).not.toContain("Plan");
    expect(firstMessage(denied).length).toBeGreaterThan(8);
    expect(denied.finish).toHaveBeenCalledWith(true);

    const act = spies();
    handle(403, "act mode requires owner role", act);
    expect(firstMessage(denied)).not.toBe(firstMessage(act));
  });

  test("401 登录失效:提示并停止重连", () => {
    const handle = loadInline<Handle>("kpChatFailureHandle");
    const a = spies();
    handle(401, "", a);
    expect(a.reconnect).not.toHaveBeenCalled();
    expect(a.showError).toHaveBeenCalledTimes(1);
    expect(firstMessage(a).length).toBeGreaterThan(4);
    expect(a.finish).toHaveBeenCalledWith(true);
  });

  test("网络错与 5xx 仍旧重连(既有自愈一字不许改坏)", () => {
    const handle = loadInline<Handle>("kpChatFailureHandle");
    for (const status of [0, 500, 502, 504]) {
      const a = spies();
      handle(status, "", a);
      expect(a.reconnect).toHaveBeenCalledTimes(1);
      expect(a.showError).not.toHaveBeenCalled();
      expect(a.finish).not.toHaveBeenCalled();
    }
  });

  test("接线:chat 流失败分支就地调用 kpChatFailureHandle", () => {
    const at = clientScript.indexOf("chat stream HTTP");
    expect(at).toBeGreaterThan(-1);
    expect(clientScript.slice(at, at + 900)).toContain("kpChatFailureHandle(");
  });

  test("拒绝提示带 kp-chat-denied 且不给重试按钮", () => {
    expect(clientScript).toContain("kp-chat-denied");
    const at = clientScript.indexOf("kp-chat-denied");
    expect(clientScript.slice(Math.max(0, at - 300), at + 300)).not.toContain("data-kp-retry");
  });
});