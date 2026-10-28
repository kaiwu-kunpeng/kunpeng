import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { Window } from "happy-dom";
import { clientScript } from "../../src/server/ui/client.js";
import { chatInvocation, streamChat } from "../../src/server/chat-stream.js";
import { resolveTaskModel } from "../../src/server/workspace-driver-deps.js";
import { ConversationStore } from "../../src/chat/conversation-store.js";

function modelSelectHtml(): string {
  const at = clientScript.indexOf("function modelSelectHtml(");
  if (at < 0) throw new Error("missing modelSelectHtml");
  let depth = 0;
  let started = false;
  for (let i = at; i < clientScript.length; i++) {
    if (clientScript[i] === "{") { depth++; started = true; }
    else if (clientScript[i] === "}" && --depth === 0 && started) {
      return (new Function(clientScript.slice(at, i + 1) + "; return modelSelectHtml();")() as string);
    }
  }
  throw new Error("unclosed modelSelectHtml");
}

function modelSelectHtmlSrc(): string {
  return extractFn("modelSelectHtml");
}

const EXPECTED = [
  "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5", "claude-sonnet-5-5", "claude-haiku-5-5", "codex", "gpt-6-astra",
  "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "claude-fable-5", "claude-fable-5-1",
];

function extractFn(name: string): string {
  const at = clientScript.indexOf("function " + name + "(");
  if (at < 0) throw new Error("missing " + name);
  let depth = 0;
  let started = false;
  for (let i = at; i < clientScript.length; i++) {
    if (clientScript[i] === "{") { depth++; started = true; }
    else if (clientScript[i] === "}" && --depth === 0 && started) return clientScript.slice(at, i + 1);
  }
  throw new Error("unclosed " + name);
}

describe("对话模型下拉及 GPT-6 三档、Sonnet 5.5、Haiku 5.5 接线（作者锁定）", () => {
  test("clientScript 语法有效", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });
  test("十四个模型顺序、显示名、默认项以及选择行为正确，已下线的三个模型不在下拉里", () => {
    const window = new Window();
    window.document.body.innerHTML = modelSelectHtml();
    const select = window.document.querySelector("select");
    expect(select).not.toBeNull();
    const values = Array.from(select!.options).map(o => o.value);
    expect(values).toEqual(EXPECTED);
    for (const gone of ["claude-opus-4-8", "claude-sonnet-4-6", "claude-opus-5[1m]"]) expect(values).not.toContain(gone);
    expect(select!.value).toBe("claude-opus-5");
    expect(select!.options[1].textContent).toBe("Opus 5.5");
    expect(select!.options[2].textContent).toBe("Sonnet 5");
    expect(select!.options[3].textContent).toBe("Sonnet 5.5");
    expect(select!.options[4].textContent).toBe("Haiku 5.5");
    expect(select!.options[5].textContent).toBe("Codex 5.5");
    expect(select!.options[6].textContent).toBe("GPT-6 Astra");
    expect(select!.options[7].textContent).toBe("GPT-6 Sol");
    expect(select!.options[8].textContent).toBe("GPT-6 Luna");
    expect(select!.options[9].textContent).toBe("GPT-5.6 Sol");
    expect(select!.options[12].textContent).toBe("Fable 5");
    expect(select!.options[13].textContent).toBe("Fable 5.1");
    select!.value = "claude-sonnet-5-5";
    // happy-dom 的 selectedOptions 首次读取后缓存,不随后续改值刷新;这里用 selectedIndex,保留下方 Astra 的 selectedOptions 断言为首次读取
    expect(select!.options[select!.selectedIndex].textContent).toBe("Sonnet 5.5");
    select!.value = "gpt-6-astra";
    expect(select!.value).toBe("gpt-6-astra");
    expect(select!.selectedOptions[0].textContent).toBe("GPT-6 Astra");
    window.close();
  });
  test("打开老会话：模型在下拉里则选中它，已下线模型回落显示 Opus 5（不留空白）", () => {
    const apply = new Function(modelSelectHtmlSrc() + "\n" + extractFn("kpApplyConvModel") + "; return { modelSelectHtml, kpApplyConvModel };")() as {
      modelSelectHtml: () => string; kpApplyConvModel: (sel: unknown, model: string) => void;
    };
    for (const [stored, shown] of [
      ["claude-haiku-5-5", "claude-haiku-5-5"], ["gpt-6-astra", "gpt-6-astra"],
      ["claude-opus-4-8", "claude-opus-5"], ["claude-sonnet-4-6", "claude-opus-5"], ["claude-opus-5[1m]", "claude-opus-5"], ["claude-haiku-4-5-20251001", "claude-opus-5"],
    ]) {
      const window = new Window();
      window.document.body.innerHTML = apply.modelSelectHtml();
      const select = window.document.querySelector("select")!;
      select.value = "gpt-6-luna";
      apply.kpApplyConvModel(select, stored);
      expect(select.value).toBe(shown);
      expect(select.selectedIndex).toBeGreaterThanOrEqual(0);
      window.close();
    }
    const at = clientScript.indexOf("if (conversation && conversation.model) {");
    expect(at).toBeGreaterThan(0);
    expect(clientScript.slice(at, at + 200)).toContain("kpApplyConvModel(m, conversation.model)");
  });
  test("GPT-6 三档（astra/sol/luna）真实路由到 codex，保留模型参数和 plan 只读约束", () => {
    for (const slug of ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]) {
      const inv = chatInvocation(slug, [], false, undefined, false, undefined, "plan");
      expect(inv.bin).toBe("codex");
      expect(inv.codex).toBe(true);
      expect(inv.args[inv.args.indexOf("-m") + 1]).toBe(slug);
      expect(inv.args[inv.args.indexOf("--sandbox") + 1]).toBe("read-only");
      expect(inv.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
      const act = chatInvocation(slug, [], false);
      expect(act.bin).toBe("codex");
      expect(act.args[act.args.indexOf("-m") + 1]).toBe(slug);
      expect(act.args).toContain("--dangerously-bypass-approvals-and-sandbox");
      expect(act.args).not.toContain("--sandbox");
      expect(act.args).toEqual(chatInvocation("gpt-5.6-sol", [], false).args.map(a => a === "gpt-5.6-sol" ? slug : a));
      expect(resolveTaskModel(slug)).toEqual({ backend: "codex", modelOverride: slug });
    }
  });
  test("既有 Codex、GPT-5.6、Claude 和未知模型行为保留", () => {
    expect(resolveTaskModel("codex")).toEqual({ backend: "codex", modelOverride: "gpt-5.5" });
    const codexArgs = chatInvocation("codex", [], false).args;
    expect(codexArgs[codexArgs.indexOf("-m") + 1]).toBe("gpt-5.5");
    for (const slug of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      expect(chatInvocation(slug, [], false).bin).toBe("codex");
      expect(resolveTaskModel(slug)).toEqual({ backend: "codex", modelOverride: slug });
    }
    expect(chatInvocation("claude-opus-5", [], false).bin).toBe("claude");
    const opus55 = chatInvocation("claude-opus-5-5", [], false);
    expect(opus55.bin).toBe("claude");
    expect(opus55.args[opus55.args.indexOf("--model") + 1]).toBe("claude-opus-5-5");
    expect(resolveTaskModel("claude-opus-5-5")).toEqual({ modelOverride: "claude-opus-5-5" });
    const sonnet55 = chatInvocation("claude-sonnet-5-5", [], false);
    expect(sonnet55.bin).toBe("claude");
    expect(sonnet55.args[sonnet55.args.indexOf("--model") + 1]).toBe("claude-sonnet-5-5");
    expect(resolveTaskModel("claude-sonnet-5-5")).toEqual({ modelOverride: "claude-sonnet-5-5" });
    const haiku55 = chatInvocation("claude-haiku-5-5", [], false);
    expect(haiku55.bin).toBe("claude");
    expect(haiku55.args[haiku55.args.indexOf("--model") + 1]).toBe("claude-haiku-5-5");
    expect(resolveTaskModel("claude-haiku-5-5")).toEqual({ modelOverride: "claude-haiku-5-5" });
    expect(chatInvocation("unknown", [], false).bin).toBe("claude");
    expect(chatInvocation("gpt-6-unknown", [], false).bin).toBe("claude");
    expect(chatInvocation("gpt-6-solar", [], false).bin).toBe("claude");
    expect(resolveTaskModel("gpt-6-unknown")).toEqual({ modelOverride: "gpt-6-unknown" });
    const src = readFileSync(new URL("../../src/server/workspace-route.ts", import.meta.url), "utf8");
    expect(src).toContain('"claude-opus-5"');
    expect(src).not.toContain('route.model ?? "claude-opus-4-8"');
  });
  test("/model gpt-6-astra 经真实 HTTP/SSE 持久化且后续路由正确", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-astra-accept-"));
    const store = new ConversationStore(join(dir, "chat"), { now: Date.now, id: () => "conv-astra-accept" });
    const server = createServer((_req, res) => {
      void streamChat("kunpeng", "/model gpt-6-astra", "claude-opus-5", [], false, dir, res, {
        store, username: "accept", projectId: "kunpeng", kunpengHome: dir,
      }).catch(error => res.destroy(error instanceof Error ? error : new Error(String(error))));
    });
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing server address");
      const response = await fetch("http://127.0.0.1:" + address.port, { signal: AbortSignal.timeout(5000) });
      const body = await response.text();
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(body).toContain("本会话模型已切 gpt-6-astra");
      const saved = await store.get("accept", "conv-astra-accept");
      expect(saved?.model).toBe("gpt-6-astra");
      expect(chatInvocation(saved!.model, [], false).bin).toBe("codex");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("/model gpt-6-luna 经真实 HTTP/SSE 持久化且后续路由正确", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-astra-accept-"));
    const store = new ConversationStore(join(dir, "chat"), { now: Date.now, id: () => "conv-luna-accept" });
    const server = createServer((_req, res) => {
      void streamChat("kunpeng", "/model gpt-6-luna", "claude-opus-5", [], false, dir, res, {
        store, username: "accept", projectId: "kunpeng", kunpengHome: dir,
      }).catch(error => res.destroy(error instanceof Error ? error : new Error(String(error))));
    });
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing server address");
      const response = await fetch("http://127.0.0.1:" + address.port, { signal: AbortSignal.timeout(5000) });
      const body = await response.text();
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(body).toContain("本会话模型已切 gpt-6-luna");
      const saved = await store.get("accept", "conv-luna-accept");
      expect(saved?.model).toBe("gpt-6-luna");
      expect(chatInvocation(saved!.model, [], false).bin).toBe("codex");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });
});