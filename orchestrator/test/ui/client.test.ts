import { describe, expect, test, vi } from "vitest";
import { Window } from "happy-dom";

import { clientScript } from "../../src/server/ui/client.js";
import { composeUserMessage } from "../../src/server/workspace-endpoints.js";
import { gateCardsFromSnapshots, renderGateCardsReply } from "../../src/server/chat-commands.js";

describe("clientScript", () => {
  test("contains router, command palette, state fetch, and valid browser JS", () => {
    expect(clientScript).toContain("#/overview");
    expect(clientScript).toContain("#/insights");
    expect(clientScript).toContain("addEventListener");
    expect(clientScript.includes("'k'") || clientScript.includes('"k"')).toBe(true);
    expect(clientScript).toContain("/api/state");
    expect(clientScript).toContain("data-conv-fork");
    expect(clientScript).toContain('action: "fork"');
    expect(clientScript).toContain("归档");
    expect(clientScript).toContain("彻底删除");
    expect(clientScript).toContain('action: "purge"');
    expect(clientScript).toContain('username + "::" + conv');
    expect(clientScript).toContain('indexedDB.open("kp-localfs", 2)');
    expect(clientScript).toContain("/api/ops/actions?days=30");
    expect(clientScript).toContain("data-ops-timeline");
    expect(clientScript).toContain("还没有动作记录,跑一波运营循环后回来看");
    expect(clientScript).toContain("data-live-sessions");
    expect(clientScript).toContain("details.nav-more");
    expect(clientScript).toContain("/pty/sessions");
    expect(clientScript).toContain("个终端会话在跑");
    expect(clientScript).toContain("elk.partitioning.activate");
    expect(clientScript).toContain("elk.partitioning.partition");
    expect(clientScript).toContain("nodeLayoutOptions");
    expect(clientScript).toContain('"curve-style": "taxi"');
    expect(clientScript).toContain("edge[feedback]");
    expect(clientScript).toContain("arch-layer-band");
    expect(clientScript).toContain("predecessors()");
    expect(clientScript).toContain("successors()");
    expect(clientScript).toContain("dbltap dblclick");
    expect(clientScript).toContain("按层");
    expect(clientScript).toContain("按簇");
    expect(clientScript).toContain("messageQueue");
    expect(clientScript).toContain("排队 ");
    expect(clientScript).toContain("SpeechRecognition");
    expect(clientScript).toContain('recognition.lang = "zh-CN"');
    expect(clientScript).toContain("kp-mic-on");
    expect(clientScript).toContain("kp-chat-mode");
    expect(clientScript).toContain("kpChatMode:");
    expect(clientScript).toContain("localStorage.setItem(chatModeStorageKey(), chatMode)");
    expect(clientScript).toContain("JSON.stringify(requestBody)");
    expect(clientScript).toContain("{ mode: chatMode }");
    expect(clientScript).toContain("data-chat-edit");
    expect(clientScript).toContain("重新生成");
    expect(clientScript).toContain("replaceLast: true");
    expect(clientScript).toContain("历史回复 ");
    expect(clientScript).toContain("Plan:只讨论方案(/code 临时执行)");
    expect(clientScript).toContain("详细");
    expect(clientScript).toContain("普通");
    expect(clientScript).toContain("结果");
    expect(clientScript).toContain('return "kp-chat-projection"');
    expect(clientScript).toContain("localStorage.setItem(projectionStorageKey(), chatProjection)");
    expect(clientScript).toContain("kp-process-group");
    expect(clientScript).toContain("kp-process-count");
    expect(clientScript).toContain("data-loop-fp");
    expect(clientScript).toContain("kp-loop-card");
    expect(clientScript).toContain("#/evolution");
    expect(clientScript).toContain('fetch("/api/attention")');
    expect(clientScript).toContain('document.querySelectorAll("[data-kp-attn]")');
    expect(clientScript).toContain("setInterval(refreshAttentionBadges, 60000)");
    for (const name of ["help", "loop", "ask", "code", "act", "model", "cost", "status", "gates", "skills", "skill", "capture", "clear"]) {
      expect(clientScript).toContain(`"name":"${name}"`);
    }
    expect(clientScript).toContain("data-kp-cmd");
    expect(clientScript).toContain("data-gate-card");
    expect(clientScript).toContain("/api/gates/discard");
    expect(clientScript).toContain("c.name.toLowerCase().indexOf(q)");
    expect(clientScript).toContain('e.key === "ArrowDown"');
    expect(clientScript).toContain('e.key === "ArrowUp"');
    expect(clientScript).toContain('e.key === "Enter"');
    expect(clientScript).toContain('e.key === "Escape"');
    expect(clientScript).toContain('input.value = "/" + c.name');
    expect(clientScript).toContain("hideMenu(); input.focus();");
    expect(clientScript).toContain("kpZipEntries");
    expect(clientScript).toContain("kpZipRead");
    expect(clientScript).toContain('new DecompressionStream("deflate-raw")');
    expect(clientScript).toContain("kpOfficeExtract");
    expect(clientScript).toContain("sharedStrings");
    expect(clientScript).toContain("【Sheet ");
    expect(clientScript).toContain("kpIsRemoteHost");
    expect(clientScript).toContain('location.hostname !== "localhost"');
    expect(clientScript).toContain("原始文件未上传");
    expect(clientScript).toContain("异地机器原始文件不上传服务器,本地提取失败:");
    expect(clientScript).toContain("异地机器不上传原始材料");
    expect(clientScript).toContain("kpIsRemoteHost() && kpIsImageAttachment(file)");
    expect(clientScript).toContain("异地机器图片管控:原图不上传");
    expect(clientScript).toContain("抽文字后发送(推荐)");
    expect(clientScript).toContain('ocrButton.className = "b pri"');
    expect(clientScript).toContain("card.appendChild(ocrButton);\n        card.appendChild(uploadButton);\n        card.appendChild(cancelButton);");
    expect(clientScript).toContain("压缩脱敏后上传");
    expect(clientScript).toContain("已取消,图片未上传");
    expect(clientScript).toContain("if (kpVendorPromises[src]) return kpVendorPromises[src]");
    expect(clientScript).toContain('kpLoadScript("/vendor/tesseract/tesseract.min.js")');
    expect(clientScript).toContain("if (kpOcrWorkerPromise) return kpOcrWorkerPromise");
    expect(clientScript).toContain('createWorker(["chi_sim", "eng"], 1, {');
    expect(clientScript).toContain('workerPath: "/vendor/tesseract/worker.min.js"');
    expect(clientScript).toContain('corePath: "/vendor/tesseract/tesseract-core-simd-lstm.wasm.js"');
    expect(clientScript).toContain('langPath: "/vendor/tesseract"');
    expect(clientScript).toContain('window.addEventListener("beforeunload"');
    expect(clientScript).toContain("worker.terminate()");
    expect(clientScript).toContain('document.createElement("textarea")');
    expect(clientScript).toContain("preview.value = text");
    expect(clientScript).toContain("OCR 文字预览,发送前可编辑");
    expect(clientScript).toContain("发送文字");
    expect(clientScript).toContain("放弃");
    expect(clientScript).toContain('originalName + ".ocr.txt"');
    expect(clientScript).toContain("未识别到文字,可改用压缩图(需确认)");
    expect(clientScript).toContain("已发送 OCR 文本 ");
    expect(clientScript).toContain("字(原图未离开本机)");
    expect(clientScript).toContain('document.createElement("canvas")');
    expect(clientScript).toContain("context.drawImage");
    expect(clientScript).toContain("canvas.toBlob");
    expect(clientScript).toContain('"image/jpeg", 0.72');
    expect(clientScript).toContain("1280 / Math.max");
    expect(clientScript).toContain(".safe.jpg");
    expect(clientScript).toContain("原图未离开本机,EXIF 已剥离");
    expect(clientScript).toContain('import("/vendor/pdfjs/pdf.min.mjs")');
    expect(clientScript).toContain('workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs"');
    expect(clientScript).toContain("if (kpPdfjsPromise) return kpPdfjsPromise");
    expect(clientScript).toContain("kpIsRemoteHost() && kpIsPdfAttachment(file)");
    expect(clientScript).toContain("pdfjs.getDocument({ data: arrayBuffer }).promise");
    expect(clientScript).toContain("page.getTextContent()");
    expect(clientScript).toContain('pages.join("\\n\\n")');
    expect(clientScript).toContain("抽取中… 第 ");
    expect(clientScript).toContain("PDF 文字预览,发送前可编辑");
    expect(clientScript).toContain('return (base || "document") + ".pdf.txt"');
    expect(clientScript).toContain("未抽到文本(可能是扫描件):可把页面截图走图片通道(默认 OCR)");
    expect(clientScript).toContain("已发送 PDF 文本 ");
    expect(clientScript).toContain("字(原文件未离开本机)");
    expect(clientScript).toContain("2 * 1024 * 1024");
    expect(clientScript).toContain('var note = "已截断\\n"');
    expect(clientScript).toContain("kpZipExtractAll");
    expect(clientScript).toContain("kpIsRemoteHost() && kpIsZipAttachment(file)");
    expect(clientScript).toContain("===== 文件: ");
    expect(clientScript).toContain("===== 跳过清单 =====");
    expect(clientScript).toContain("嵌套过深");
    expect(clientScript).toContain("txt|md|csv|json|js|ts|py|html|xml|yaml|yml|log");
    expect(clientScript).toContain("解包抽取中… ");
    expect(clientScript).toContain("ZIP 文字预览,发送前可编辑");
    expect(clientScript).toContain('return (base || "archive") + ".zip.txt"');
    expect(clientScript).toContain("包内没有可抽取的文本");
    expect(clientScript).toContain("已发送压缩包文本 ");
    expect(clientScript).toContain("字(原包未离开本机)");
    expect(clientScript).toContain("kpUploadRawAttachment(file).catch(function () {});");
    expect(clientScript).toContain("kp-sensitive-chip");
    expect(clientScript).toContain("JSON.stringify({ sensitive: nextSensitive })");
    expect(clientScript).toContain('requestBody.sensitive = win.getAttribute("data-sensitive") === "true"');
    expect(clientScript).toContain("异地机器:本会话默认敏感,内容不进知识库(点 🔒 可关)");
    expect(clientScript).toContain("敏感·不进知识库");
    expect(clientScript).toContain("直到手动解锁");
    expect(clientScript).toContain("分叉的会话继承此锁");
    expect(clientScript).toContain("账号 ");
    expect(clientScript).toContain("本地压缩失败:");
    expect(clientScript).toContain(",原图未上传");
    expect(clientScript).toContain("png|jpg|jpeg|gif|webp|pdf|docx|xlsx|pptx|zip|gz|tar|bin|dylib|so|class");
    expect(clientScript).toContain("2 * 1024 * 1024");
    expect(clientScript).toContain("5 * 1024 * 1024");
    expect(clientScript).toContain("10 * 1024 * 1024");
    expect(clientScript).toContain("路径不存在");
    expect(clientScript).toContain("目录授权已失效,请点 📁 重新授权");
    expect(clientScript).toContain("TypeMismatchError");
    expect(() => new Function(clientScript)).not.toThrow();
  });

  test("runs inbox keyboard navigation, confirmation expiry, actions, and help only in inbox", async () => {
    const browser = new Window({ url: "http://localhost/#/inbox" });
    vi.stubGlobal("window", browser);
    vi.stubGlobal("document", browser.document);
    vi.stubGlobal("navigator", browser.navigator);
    vi.stubGlobal("location", browser.location);
    vi.stubGlobal("localStorage", browser.localStorage);
    vi.stubGlobal("KeyboardEvent", browser.KeyboardEvent);
    vi.stubGlobal("setInterval", vi.fn(() => 0));
    vi.stubGlobal("clearInterval", vi.fn());
    document.documentElement.innerHTML = '<head></head><body><div id="view"></div></body>';
    window.location.hash = "#/inbox";
    const calls: string[] = [];
    const confirm = vi.fn(() => true);
    Object.assign(browser, { confirm });
    const confirmationTimers: Array<{ callback: () => void; delay: number }> = [];
    vi.spyOn(browser, "setTimeout").mockImplementation((callback, delay, ...args) => {
      confirmationTimers.push({ callback: () => callback(...args), delay: Number(delay ?? 0) });
      const timer = setTimeout(() => undefined, 0);
      clearTimeout(timer);
      return timer;
    });
    vi.spyOn(browser, "clearTimeout").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url === "/api/state") {
        return Promise.resolve({ ok: true, json: async () => ({ projects: [{ id: "current", name: "current" }] }) });
      }
      if (url.startsWith("/api/view")) return Promise.resolve({ ok: true, text: async () => "" });
      if (url === "/api/merge" || url === "/api/reject") return new Promise(() => {});
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, waiting: 0 }) });
    }));

    try {
      new Function(clientScript)();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const view = document.getElementById("view")!;
      view.innerHTML = `
        <div class="inbox-wrap">
          <div class="gate" data-kp-inbox-item data-kp-inbox-id="merge:f1" data-flow="f1">
            <div class="gate-b">first detail</div>
            <button data-kp-act="approve" data-action="merge-main" data-flow="f1"><b>Approve</b></button>
            <button data-kp-act="reject" data-action="reject" data-flow="f1">Reject</button>
          </div>
          <div class="gate" data-kp-inbox-item data-kp-inbox-id="proposal:p2" data-id="p2">
            <div class="gate-b">second detail</div>
            <button data-kp-act="approve" data-action="approve-apply" data-id="p2">Approve</button>
            <button data-kp-act="reject" data-action="reject" data-id="p2">Reject</button>
          </div>
        </div>
        <input data-test-input>
      `;
      const items = Array.from(view.querySelectorAll<HTMLElement>("[data-kp-inbox-item]"));
      const firstScroll = vi.fn();
      const secondScroll = vi.fn();
      items[0]!.scrollIntoView = firstScroll;
      items[1]!.scrollIntoView = secondScroll;
      const press = (key: string, init: KeyboardEventInit = {}, target: Document | Element = document) => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
      };

      press("j");
      expect(items[0]!.classList.contains("active")).toBe(true);
      expect(firstScroll).toHaveBeenCalledWith({ block: "nearest" });

      press("j", {}, view.querySelector("[data-test-input]")!);
      expect(items[0]!.classList.contains("active")).toBe(true);

      press("j");
      expect(items[1]!.classList.contains("active")).toBe(true);
      expect(secondScroll).toHaveBeenCalledWith({ block: "nearest" });
      press("k");
      expect(items[0]!.classList.contains("active")).toBe(true);

      press("e");
      expect((items[0]!.querySelector(".gate-b") as HTMLElement).hidden).toBe(true);

      const approve = items[0]!.querySelector<HTMLElement>('[data-kp-act="approve"]')!;
      press("a");
      expect(approve.textContent).toBe("再按 a 确认");
      expect(calls).not.toContain("/api/merge");
      expect(confirmationTimers.at(-1)?.delay).toBe(3000);
      confirmationTimers.at(-1)?.callback();
      expect(approve.innerHTML).toBe("<b>Approve</b>");

      press("a");
      press("a");
      expect(calls).toContain("/api/merge");
      expect(items[1]!.classList.contains("active")).toBe(true);

      press("d");
      expect(items[1]!.querySelector('[data-kp-act="reject"]')!.textContent).toBe("再按 d 确认驳回");
      press("d");
      expect(calls).toContain("/api/reject");
      expect(items.some((item) => item.classList.contains("active"))).toBe(false);

      press("?");
      expect(document.querySelector(".kp-inbox-help")?.textContent).toContain("j / k");
      press("Escape");
      expect(document.querySelector(".kp-inbox-help")).toBeNull();

      window.location.hash = "#/overview";
      press("j");
      expect(items.some((item) => item.classList.contains("active"))).toBe(false);
    } finally {
      browser.close();
      vi.unstubAllGlobals();
    }
  });

  test("marks browser-extracted text without server-side Office parsing instructions", () => {
    const message = composeUserMessage("总结附件", [], [{
      path: "/tmp/report.docx.extracted.txt",
      name: "report.docx.extracted.txt",
    }], false);
    expect(message).toContain("- report.docx.extracted.txt(浏览器端已提取的文本,直接读取)");
    expect(message).toContain("/tmp/report.docx.extracted.txt");
    expect(message).not.toContain("用 python 解析");
  });
});

describe("gate card server projection", () => {
  test("projects humanGates with real flow metadata and escapes the full JSON attribute", () => {
    const cards = gateCardsFromSnapshots([{
      id: "p-1",
      name: '项目"><img src=x onerror=1>',
      state: {
        humanGates: [{ what: "合并主干", detail: "kp/f-1 → main", flowId: "f-1" }],
        flows: [{ flowId: "f-1", planId: "plan-1", startedAt: 1_700_000_000_000 }],
      },
    }]);
    expect(cards).toEqual([{
      id: "f-1",
      planId: "plan-1",
      kind: "merge",
      title: "合并主干",
      branch: "kp/f-1",
      project: { id: "p-1", name: '项目"><img src=x onerror=1>' },
      createdAt: 1_700_000_000_000,
    }]);
    const reply = renderGateCardsReply(cards);
    expect(reply).toContain("data-gate-card");
    expect(reply).not.toContain("<img");
    const encoded = /data-gate-card="([^"]+)"/.exec(reply)?.[1] ?? "";
    const json = encoded
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
    expect(JSON.parse(json)).toEqual(cards[0]);
    expect(renderGateCardsReply([])).toBe("当前没有待审门 ✅");
  });
});
