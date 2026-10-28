import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

const DELAYS = [1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000];
const WINDOW = 120000;

/** 从 clientScript 里抠出内联的 kpReconnectDecide,独立 eval 后返回该函数。 */
function loadDecide(): (stamps: number[], now: number, windowMs: number, delays: number[]) => { allow: boolean; delayMs: number; stamps: number[] } {
  const at = clientScript.indexOf("function kpReconnectDecide(");
  if (at < 0) throw new Error("clientScript 里找不到内联的 kpReconnectDecide");
  let depth = 0;
  let started = false;
  let end = -1;
  for (let i = at; i < clientScript.length; i += 1) {
    const ch = clientScript[i];
    if (ch === "{") { depth += 1; started = true; }
    else if (ch === "}") { depth -= 1; if (started && depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error("kpReconnectDecide 函数体括号不闭合");
  const src = clientScript.slice(at, end);
  return new Function(`${src}; return kpReconnectDecide;`)() as ReturnType<typeof loadDecide>;
}

describe("对话重连预算 · 滑动窗口", () => {
  test("clientScript 语法有效(防 SPA 崩)", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  test("累计计数器已消失", () => {
    expect(clientScript).not.toContain("reconnectAttempt += 1");
  });

  test("长对话里稀疏掉线永不判死(本条在旧实现上必然失败)", () => {
    const decide = loadDecide();
    let stamps: number[] = [];
    let now = 0;
    // 30 分钟内每 3 分钟掉一次,共 10 次 —— 旧实现第 9 次就判死
    for (let i = 0; i < 10; i += 1) {
      now += 180000;
      const r = decide(stamps, now, WINDOW, DELAYS);
      expect(r.allow).toBe(true);
      expect(r.delayMs).toBe(1000);
      stamps = r.stamps;
    }
    expect(stamps.length).toBe(1);
  });

  test("窗口内连续失败超预算即判死", () => {
    const decide = loadDecide();
    let stamps: number[] = [];
    let now = 1000000;
    for (let i = 0; i < DELAYS.length; i += 1) {
      now += 1000;
      const r = decide(stamps, now, WINDOW, DELAYS);
      expect(r.allow).toBe(true);
      stamps = r.stamps;
    }
    now += 1000;
    expect(decide(stamps, now, WINDOW, DELAYS).allow).toBe(false);
  });

  test("退避时长随窗口内次数递增并封顶", () => {
    const decide = loadDecide();
    let stamps: number[] = [];
    let now = 500000;
    const got: number[] = [];
    for (let i = 0; i < DELAYS.length; i += 1) {
      now += 1000;
      const r = decide(stamps, now, WINDOW, DELAYS);
      got.push(r.delayMs);
      stamps = r.stamps;
    }
    expect(got).toEqual(DELAYS);
  });

  test("不修改入参且窗口外时间戳被剪枝", () => {
    const decide = loadDecide();
    const original = [100, 200, 300];
    const frozen = original.slice();
    const r = decide(original, 100 + WINDOW + 1, WINDOW, DELAYS);
    expect(original).toEqual(frozen);
    expect(r.stamps).toEqual([200, 300, 100 + WINDOW + 1]);
  });
});