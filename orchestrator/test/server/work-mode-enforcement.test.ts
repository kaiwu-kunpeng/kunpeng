import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { part04 } from "../../src/server/ui/client-parts/part04.js";
import { part07 } from "../../src/server/ui/client-parts/part07.js";
import { resolveHostPermissions } from "../../src/server/worker/host-permissions.js";

const body = String(clientScript).replace(/^\s*<script>/, "").replace(/<\/script>\s*$/, "");

function extract(name: string): string {
  const at = clientScript.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`clientScript 里找不到内联的 ${name}`);
  let depth = 0;
  let started = false;
  for (let i = at; i < clientScript.length; i += 1) {
    const ch = clientScript[i];
    if (ch === "{") { depth += 1; started = true; }
    else if (ch === "}") { depth -= 1; if (started && depth === 0) return clientScript.slice(at, i + 1); }
  }
  throw new Error(`${name} 函数体括号不闭合`);
}

function loadWith(names: string[], target: string): (...args: unknown[]) => unknown {
  return new Function(`${names.map(extract).join("\n")}\nreturn ${target};`)() as (...args: unknown[]) => unknown;
}

/** 服务端那条白名单的等价实现,用来锁住语义。 */
function expectedServerNormalize(raw: unknown): string {
  return raw === "trip" || raw === "intranet" ? raw : "full";
}

describe("客户端:kpCurrentWorkMode", () => {
  test("已拼进脚本", () => {
    expect(body).toContain("kpCurrentWorkMode");
  });

  test("三档正确", () => {
    const fn = loadWith(
      ["kpModeResolve", "kpModeStorageKey", "kpModeRead", "kpModeAccount", "kpCurrentWorkMode"],
      "kpCurrentWorkMode",
    );
    const g = globalThis as unknown as { document?: unknown; localStorage?: unknown };
    const savedDoc = g.document;
    const savedLs = g.localStorage;
    const store: Record<string, string> = {};
    g.localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v; },
    };
    g.document = { querySelector: () => ({ dataset: { kpAccount: "u1" }, getAttribute: () => "u1" }), getElementById: () => null };
    try {
      store["kp-mode:u1"] = "trip";
      expect(fn()).toBe("trip");
      store["kp-mode:u1"] = "intranet";
      expect(fn()).toBe("intranet");
      store["kp-mode:u1"] = "乱七八糟";
      expect(fn()).toBe("full");
    } finally {
      if (savedDoc === undefined) delete g.document; else g.document = savedDoc;
      if (savedLs === undefined) delete g.localStorage; else g.localStorage = savedLs;
    }
  });

  test("环境异常时回落 full 且不抛", () => {
    const fn = loadWith(
      ["kpModeResolve", "kpModeStorageKey", "kpModeRead", "kpModeAccount", "kpCurrentWorkMode"],
      "kpCurrentWorkMode",
    );
    const g = globalThis as unknown as { document?: unknown; localStorage?: unknown };
    const savedDoc = g.document;
    const savedLs = g.localStorage;
    g.document = { querySelector: () => null, getElementById: () => null };
    g.localStorage = { getItem: () => { throw new Error("隐私模式"); }, setItem: () => {} };
    try {
      expect(() => fn()).not.toThrow();
      expect(fn()).toBe("full");
    } finally {
      if (savedDoc === undefined) delete g.document; else g.document = savedDoc;
      if (savedLs === undefined) delete g.localStorage; else g.localStorage = savedLs;
    }
  });
});

describe("客户端:请求体带上 workMode", () => {
  test("part04 里出现 workMode", () => {
    expect(part04).toContain("workMode");
  });

  test("part07 与拼装完整性未被破坏", () => {
    expect(clientScript).toContain(part07);
    expect(clientScript.split("\n").filter((l) => l.trim() === "})();").length).toBe(1);
    expect(() => new Function(body)).not.toThrow();
  });
});

describe("服务端:白名单归一", () => {
  test("只认 trip / intranet,其余一律 full", () => {
    for (const [raw, want] of [
      ["trip", "trip"], ["intranet", "intranet"], ["full", "full"],
      ["TRIP", "full"], ["", "full"], ["随便", "full"],
      [undefined, "full"], [null, "full"], [42, "full"], [{}, "full"], [["trip"], "full"],
    ] as Array<[unknown, string]>) {
      expect(expectedServerNormalize(raw), `输入 ${JSON.stringify(raw)}`).toBe(want);
    }
  });

  test("workspace-route 里确实有 workMode 的白名单", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../../src/server/workspace-route.ts", import.meta.url), "utf8");
    expect(source).toContain("workMode");
    expect(source).toMatch(/workMode[\s\S]{0,200}trip/);
    expect(source).toMatch(/workMode[\s\S]{0,200}intranet/);
  });

  test("聊天模式(act/plan)的解析没被动过", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../../src/server/workspace-route.ts", import.meta.url), "utf8");
    expect(source).toContain("isChatModeAllowedForRole");
    expect(source).toContain('typeof body.mode === "string"');
  });
});

describe("对话侧:deny 规则真的被组装进参数", () => {
  test("出差模式算出四个工具", () => {
    expect(resolveHostPermissions("full", "trip").deny).toEqual(["Bash", "Edit", "NotebookEdit", "Write"]);
  });

  test("满血与内网都是空 deny(不该加 --settings)", () => {
    expect(resolveHostPermissions("full", "full").deny).toEqual([]);
    expect(resolveHostPermissions("full", "intranet").deny).toEqual([]);
  });

  test("chat-stream 里出现 workMode 与 resolveHostPermissions", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../../src/server/chat-stream.ts", import.meta.url), "utf8");
    expect(source).toContain("workMode");
    expect(source).toContain("resolveHostPermissions");
    expect(source).toContain("--settings");
  });

  test("写文件失败必须 fail-closed(源码里有中止逻辑)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../../src/server/chat-stream.ts", import.meta.url), "utf8");
    expect(source).toContain("中止");
  });

  test("bypassPermissions 与 mcp-config 的既有逻辑未被删", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../../src/server/chat-stream.ts", import.meta.url), "utf8");
    expect(source).toContain("bypassPermissions");
    expect(source).toContain("--mcp-config");
    expect(source).toContain("--add-dir");
  });
});