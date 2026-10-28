import { describe, expect, test } from "vitest";
import { parseSendArgs } from "../src/cli-commands/switchboard.js";

const ok = (rest: string[]) => {
  const parsed = parseSendArgs(rest);
  if (!parsed.ok) throw new Error(`期望解析成功,实际: ${parsed.error}`);
  return parsed;
};

describe("位置写法与改动前等价", () => {
  test("<to> <message...>", () => {
    const r = ok(["main", "你好", "世界"]);
    expect(r.to).toBe("main");
    expect(r.body).toBe("你好 世界");
    expect(r.topic).toBeUndefined();
  });

  test("位置写法带 --topic/--from 不漏进正文", () => {
    const r = ok(["main", "--topic", "协调", "正文在此", "--from", "cockpit"]);
    expect(r.to).toBe("main");
    expect(r.body).toBe("正文在此");
    expect(r.topic).toBe("协调");
  });
});

describe("旗标写法(此前静默错投的那批)", () => {
  test("--to X --body Y", () => {
    const r = ok(["--to", "main", "--body", "cockpit收到。", "继续"]);
    expect(r.to).toBe("main");
    expect(r.body).toBe("cockpit收到。 继续");
  });

  test("--msg/--text/--message 同等对待", () => {
    expect(ok(["--to", "a", "--msg", "m1"]).body).toBe("m1");
    expect(ok(["--to", "a", "--text", "m2"]).body).toBe("m2");
    expect(ok(["--to", "a", "--message", "m3"]).body).toBe("m3");
  });

  test("--as/--subject 的值不漏进正文", () => {
    const r = ok(["--to", "product-track-session", "--as", "cockpit-session", "--subject", "autopilot", "我要做合并门自动驾驶"]);
    expect(r.to).toBe("product-track-session");
    expect(r.body).toBe("我要做合并门自动驾驶");
  });

  test("--type <kind> 且无 --to 时,收件人取第一个非旗标 token", () => {
    const r = ok(["--type", "task", "all", "【开工】干活了"]);
    expect(r.to).toBe("all");
    expect(r.kind).toBe("task");
    expect(r.body).toBe("【开工】干活了");
  });

  test("kind 不合法只是不带该字段,不报错", () => {
    const r = ok(["--to", "all", "--type", "kickoff", "播报正文"]);
    expect(r.kind).toBeUndefined();
    expect(r.body).toBe("播报正文");
    expect(r.to).toBe("all");
  });

  test("--urgent 不吃掉后面的 token", () => {
    const r = ok(["--to", "all", "--urgent", "紧急正文"]);
    expect(r.body).toBe("紧急正文");
  });
});

describe("非法输入必须硬失败", () => {
  test("收件人是旗标名 → 拒收", () => {
    const r = parseSendArgs(["--to"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("收件人缺失或非法（不要把旗标名当收件人）");
  });

  test("完全没有收件人 → 拒收", () => {
    const r = parseSendArgs([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("收件人缺失或非法（不要把旗标名当收件人）");
  });

  test("有收件人但正文为空 → 拒收", () => {
    const r = parseSendArgs(["main", "   "]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("正文为空");
  });

  test("--to 后面直接结束 → 拒收", () => {
    const r = parseSendArgs(["--to", "--body", "x"]);
    expect(r.ok).toBe(false);
  });
});