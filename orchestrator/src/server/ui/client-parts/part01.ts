export const part01: string = `  function kpCtxEstimate(usage) {
    function token(value) {
      var parsed = Number(value);
      return isFinite(parsed) && parsed > 0 ? parsed : 0;
    }
    var used = token(usage && usage.input)
      + token(usage && usage.cacheCreate)
      + token(usage && usage.cacheRead);
    var model = String(usage && usage.model ? usage.model : "").toLowerCase();
    var isOpenAi = model === "codex" || model.indexOf("gpt-") === 0;
    var contextWindow = isOpenAi ? 272000
      : (model.indexOf("sonnet") >= 0 || model.indexOf("fable") >= 0 || model.indexOf("[1m]") >= 0 ? 1000000 : 200000);
    return { used: used, window: contextWindow, ratio: used / contextWindow };
  }

  function kpCostUsd(model, tokens) {
    try {
      var normalizedModel = String(model).toLowerCase();
      var entry = KP_PRICING.table.find(function (entry) {
        return normalizedModel.indexOf(entry.match) >= 0;
      });
      var rate = entry ? entry.usd : KP_PRICING.def;
      var tokenCount = Number(tokens);
      var cost = (tokenCount / 1000000) * Number(rate);
      return isFinite(cost) && cost >= 0 ? cost : 0;
    } catch (_e) {
      return 0;
    }
  }
  window.kpCostUsd = kpCostUsd;

  function refreshAttentionBadges() {
    return fetch("/api/attention").then(function (response) {
      if (!response.ok) throw new Error("attention request failed");
      return response.json();
    }).then(function (payload) {
      var rawWaiting = payload && payload.waiting;
      var waiting = typeof rawWaiting === "number" && isFinite(rawWaiting)
        ? Math.max(0, Math.floor(rawWaiting))
        : 0;
      document.querySelectorAll("[data-kp-attn]").forEach(function (badge) {
        badge.textContent = String(waiting);
        badge.hidden = waiting === 0;
        if (waiting > 0 && badge.classList.contains("kp-attn-badge")) badge.classList.add("badge");
      });
    }).catch(function () {});
  }

  function kpLoadScript(src) {
    if (kpVendorPromises[src]) return kpVendorPromises[src];
    kpVendorPromises[src] = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () { delete kpVendorPromises[src]; reject(new Error("vendor load failed: " + src)); };
      document.head.appendChild(script);
    });
    return kpVendorPromises[src];
  }

  function kpLoadStylesheet(href) {
    var key = "style:" + href;
    if (kpVendorPromises[key]) return kpVendorPromises[key];
    var existing = document.querySelector('link[rel="stylesheet"][href="' + href + '"]');
    if (existing) return Promise.resolve();
    kpVendorPromises[key] = new Promise(function (resolve, reject) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = function () { resolve(); };
      link.onerror = function () { delete kpVendorPromises[key]; reject(new Error("vendor load failed: " + href)); };
      document.head.appendChild(link);
    });
    return kpVendorPromises[key];
  }

  function kpEnsureMermaid() {
    if (kpMermaidReadyPromise) return kpMermaidReadyPromise;
    kpMermaidReadyPromise = kpLoadScript("/vendor/mermaid/mermaid.min.js").then(function () {
      if (!window.mermaid || typeof window.mermaid.initialize !== "function" || typeof window.mermaid.render !== "function") {
        throw new Error("Mermaid 引擎加载失败");
      }
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default"
      });
      return window.mermaid;
    }).catch(function (error) {
      kpMermaidReadyPromise = null;
      throw error;
    });
    return kpMermaidReadyPromise;
  }

  function kpEnsureKatex() {
    if (kpKatexReadyPromise) return kpKatexReadyPromise;
    kpKatexReadyPromise = Promise.all([
      kpLoadStylesheet("/vendor/katex/katex.min.css"),
      kpLoadScript("/vendor/katex/katex.min.js")
    ]).then(function () {
      if (!window.katex || typeof window.katex.render !== "function") throw new Error("KaTeX 引擎加载失败");
      return window.katex;
    }).catch(function (error) {
      kpKatexReadyPromise = null;
      throw error;
    });
    return kpKatexReadyPromise;
  }

  function kpMermaidFailure(block) {
    if (!block || block.querySelector(".kp-mermaid-error")) return;
    var error = document.createElement("div");
    error.className = "kp-mermaid-error";
    error.textContent = "图表语法错误";
    block.appendChild(error);
  }

  function kpRenderMermaidBlock(block, source) {
    if (!block || block.getAttribute("data-kp-mermaid-rendered") === "true") return;
    block.setAttribute("data-kp-mermaid-rendered", "true");
    var sourceView = block.querySelector(".kp-mermaid-source");
    var output = block.querySelector(".kp-mermaid-output");
    var toggle = block.querySelector("[data-kp-mermaid-source]");
    kpEnsureMermaid().then(function (mermaid) {
      var renderId = "kp-mermaid-" + Date.now().toString(36) + "-" + (kpMermaidSequence++);
      return Promise.resolve(mermaid.render(renderId, source)).then(function (result) {
        if (!result || typeof result.svg !== "string") throw new Error("Mermaid 未返回 SVG");
        output.innerHTML = result.svg;
        output.hidden = false;
        sourceView.hidden = true;
        toggle.hidden = false;
        block.setAttribute("data-kp-mermaid-state", "diagram");
      });
    }).catch(function () {
      output.hidden = true;
      sourceView.hidden = false;
      toggle.hidden = true;
      block.setAttribute("data-kp-mermaid-state", "source");
      kpMermaidFailure(block);
    });
  }

  function kpRenderKatexBlock(block, formula, original) {
    if (!block || block.getAttribute("data-kp-katex-rendered") === "true") return;
    block.setAttribute("data-kp-katex-rendered", "true");
    kpEnsureKatex().then(function (katex) {
      katex.render(formula, block, { displayMode: true, throwOnError: false });
    }).catch(function () {
      block.textContent = original;
      block.setAttribute("data-kp-katex-state", "source");
    });
  }

  function kpRenderMarkdown(raw) {
    var src = String(raw == null ? "" : raw);
    var fence = String.fromCharCode(96, 96, 96);
    var inlineTick = String.fromCharCode(96);
    // 安全边界:先转义全部原文,后续规则只处理转义后的字符串。
    var lines = escHtml(src).replace(/\\r\\n?/g, "\\n").split("\\n");
    var html = [];
    var paragraph = [];
    var listTag = "";
    var listItems = [];
    var codeLines = null;
    var codeLanguage = "code";

    function renderInline(text) {
      var output = "";
      var cursor = 0;
      while (cursor < text.length) {
        var ch = text.charAt(cursor);
        if (ch === inlineTick) {
          var codeEnd = text.indexOf(inlineTick, cursor + 1);
          if (codeEnd > cursor + 1) {
            output += '<code class="kp-md-ic">' + text.slice(cursor + 1, codeEnd) + "</code>";
            cursor = codeEnd + 1;
            continue;
          }
        }
        if (ch === "[") {
          var labelEnd = text.indexOf("](", cursor + 1);
          var linkEnd = labelEnd >= 0 ? text.indexOf(")", labelEnd + 2) : -1;
          if (labelEnd > cursor + 1 && linkEnd > labelEnd + 2) {
            var label = text.slice(cursor + 1, labelEnd);
            var href = text.slice(labelEnd + 2, linkEnd);
            var protocol = href.toLowerCase();
            if (protocol.indexOf("http://") === 0 || protocol.indexOf("https://") === 0) {
              output += '<a href="' + href + '" rel="noopener noreferrer" target="_blank">' + label + "</a>";
              cursor = linkEnd + 1;
              continue;
            }
            output += text.slice(cursor, linkEnd + 1);
            cursor = linkEnd + 1;
            continue;
          }
        }
        var strongMarker = text.slice(cursor, cursor + 2);
        if (strongMarker === "**" || strongMarker === "__") {
          var strongEnd = text.indexOf(strongMarker, cursor + 2);
          if (strongEnd > cursor + 2) {
            output += "<strong>" + renderInline(text.slice(cursor + 2, strongEnd)) + "</strong>";
            cursor = strongEnd + 2;
            continue;
          }
        }
        if (ch === "*" || ch === "_") {
          var emphasisEnd = text.indexOf(ch, cursor + 1);
          if (emphasisEnd > cursor + 1) {
            output += "<em>" + renderInline(text.slice(cursor + 1, emphasisEnd)) + "</em>";
            cursor = emphasisEnd + 1;
            continue;
          }
        }
        output += ch;
        cursor += 1;
      }
      return output;
    }

    function flushParagraph() {
      if (!paragraph.length) return;
      html.push("<p>" + paragraph.map(renderInline).join("<br>") + "</p>");
      paragraph = [];
    }
    function flushList() {
      if (!listTag || !listItems.length) return;
      html.push("<" + listTag + ">" + listItems.map(function (item) {
        return "<li>" + renderInline(item) + "</li>";
      }).join("") + "</" + listTag + ">");
      listTag = "";
      listItems = [];
    }
    function flushBlocks() {
      flushParagraph();
      flushList();
    }
    function flushCode() {
      var isLong = codeLines.length > 20;
      var blockClass = "kp-code-block" + (isLong ? " kp-code-long" : "");
      var toggle = isLong
        ? '<button type="button" class="kp-code-toggle" aria-expanded="false">展开</button>'
        : "";
      html.push(
        '<div class="' + blockClass + '">' +
          '<div class="kp-code-head">' +
            '<span class="kp-code-lang">' + codeLanguage + "</span>" +
            '<span class="kp-code-actions">' + toggle + '<button type="button" class="kp-code-copy">复制</button></span>' +
          "</div>" +
          '<pre class="kp-md-code"><code>' + codeLines.join("\\n") + "</code></pre>" +
        "</div>",
      );
      codeLines = null;
      codeLanguage = "code";
    }

    lines.forEach(function (line) {
      if (codeLines !== null) {
        if (line.slice(0, fence.length) === fence && line.slice(fence.length).trim() === "") flushCode();
        else codeLines.push(line);
        return;
      }
      if (line.slice(0, fence.length) === fence) {
        flushBlocks();
        codeLanguage = line.slice(fence.length).trim() || "code";
        codeLines = [];
        return;
      }
      if (!line.trim()) {
        flushBlocks();
        return;
      }
      var heading = /^(#{1,6})\\s+(.+)$/.exec(line);
      if (heading) {
        flushBlocks();
        var level = heading[1].length;
        html.push("<h" + level + ' class="kp-md-h">' + renderInline(heading[2]) + "</h" + level + ">");
        return;
      }
      var unordered = /^[-*]\\s+(.+)$/.exec(line);
      var ordered = /^(?:\\d+)\\.\\s+(.+)$/.exec(line);
      if (unordered || ordered) {
        flushParagraph();
        var nextTag = unordered ? "ul" : "ol";
        if (listTag && listTag !== nextTag) flushList();
        listTag = nextTag;
        listItems.push((unordered || ordered)[1]);
        return;
      }
      flushList();
      paragraph.push(line);
    });
    flushBlocks();
    if (codeLines !== null) flushCode();
    return html.join("");
  }
  if (typeof window !== "undefined") window.kpRenderMarkdown = kpRenderMarkdown;

  function kpHydrateCompletedMessage(message) {
    if (!message || message.getAttribute("data-kp-rich-rendered") === "true") return;
    message.setAttribute("data-kp-rich-rendered", "true");
    var raw = message.getAttribute("data-copy") || "";
    var fence = String.fromCharCode(96, 96, 96);
    var richPattern = new RegExp(fence + "mermaid[ \\t]*\\r?\\n([\\s\\S]*?)" + fence + "|\\$\\$([\\s\\S]*?)\\$\\$", "gi");
    var matches = [];
    var match;
    while ((match = richPattern.exec(raw)) !== null) {
      if ((match[1] || match[2] || "").trim()) matches.push({ index: match.index, full: match[0], mermaid: match[1], formula: match[2] });
      if (match[0] === "") richPattern.lastIndex += 1;
    }
    var content = document.createElement("span");
    content.className = "kp-msg-content";
    if (!matches.length) {
      content.innerHTML = kpRenderMarkdown(raw);
    } else {
      var cursor = 0;
      matches.forEach(function (item) {
        if (item.index > cursor) {
          var prose = document.createElement("span");
          prose.className = "kp-md-segment";
          prose.innerHTML = kpRenderMarkdown(raw.slice(cursor, item.index));
          content.appendChild(prose);
        }
        if (item.mermaid !== undefined) {
          var diagram = document.createElement("div");
          diagram.className = "kp-mermaid";
          var sourceView = document.createElement("pre");
          sourceView.className = "kp-mermaid-source";
          var code = document.createElement("code");
          code.textContent = item.mermaid;
          sourceView.appendChild(code);
          var output = document.createElement("div");
          output.className = "kp-mermaid-output";
          output.hidden = true;
          var toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "kp-mermaid-toggle";
          toggle.setAttribute("data-kp-mermaid-source", "");
          toggle.textContent = "查看源码";
          toggle.hidden = true;
          diagram.appendChild(sourceView);
          diagram.appendChild(output);
          diagram.appendChild(toggle);
          content.appendChild(diagram);
          kpRenderMermaidBlock(diagram, item.mermaid.trim());
        } else {
          var formula = document.createElement("div");
          formula.className = "kp-katex";
          formula.textContent = item.full;
          content.appendChild(formula);
          kpRenderKatexBlock(formula, item.formula.trim(), item.full);
        }
        cursor = item.index + item.full.length;
      });
      if (cursor < raw.length) {
        var tail = document.createElement("span");
        tail.className = "kp-md-segment";
        tail.innerHTML = kpRenderMarkdown(raw.slice(cursor));
        content.appendChild(tail);
      }
    }
    Array.prototype.slice.call(message.childNodes).forEach(function (node) {
      if (node.nodeType === 3) message.removeChild(node);
    });
    message.insertBefore(content, message.firstChild);
  }

  function kpHydrateCompletedMessages(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll(".kp-msg[data-copy]").forEach(kpHydrateCompletedMessage);
  }

  function kpEnsureVendor(kind) {
    if (kind === "graph") {
      if (typeof window.cytoscape === "function" && typeof window.cytoscapeElk !== "undefined") return Promise.resolve();
      return kpLoadScript("/vendor/cytoscape.min.js")
        .then(function () { return kpLoadScript("/vendor/elk.bundled.js"); })
        .then(function () { return kpLoadScript("/vendor/cytoscape-elk.js"); });
    }
    if (kind === "term") {
      if (typeof window.Terminal === "function") return Promise.resolve();
      return kpLoadScript("/vendor/xterm.min.js")
        .then(function () { return kpLoadScript("/vendor/xterm-addon-fit.min.js"); });
    }
    return Promise.resolve();
  }

  function kpEnsureOcrWorker() {
    if (kpOcrWorkerPromise) return kpOcrWorkerPromise;
    kpOcrWorkerPromise = kpLoadScript("/vendor/tesseract/tesseract.min.js").then(function () {
      if (!window.Tesseract || typeof window.Tesseract.createWorker !== "function") {
        throw new Error("OCR 引擎加载失败");
      }
      return window.Tesseract.createWorker(["chi_sim", "eng"], 1, {
        workerPath: "/vendor/tesseract/worker.min.js",
        corePath: "/vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
        langPath: "/vendor/tesseract"
      });
    }).catch(function (error) {
      kpOcrWorkerPromise = null;
      throw error;
    });
    return kpOcrWorkerPromise;
  }

  function kpRecognizeRemoteImage(file) {
    var job = kpOcrQueue.then(function () {
      return kpEnsureOcrWorker();
    }).then(function (worker) {
      return worker.recognize(file);
    });
    kpOcrQueue = job.then(function () {}, function (error) {
      console.error("OCR 识别失败", error);
    });
    return job;
  }

  function kpEnsurePdfjs() {
    if (kpPdfjsPromise) return kpPdfjsPromise;
    kpPdfjsPromise = import("/vendor/pdfjs/pdf.min.mjs").then(function (pdfjs) {
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
      return pdfjs;
    });
    return kpPdfjsPromise;
  }

  window.addEventListener("beforeunload", function () {
    if (!kpOcrWorkerPromise) return;
    kpOcrWorkerPromise.then(function (worker) {
      return worker.terminate();
    }).catch(function (error) {
      console.error("OCR worker 关闭失败", error);
    });
    kpOcrWorkerPromise = null;
  });

  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-solution-apply]") : null;
    if (!btn) return;
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = "装入中…";
    fetch("/api/solutions/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: btn.getAttribute("data-solution-apply"), projectId: btn.getAttribute("data-project") }),
    }).then(function (res) { return res.json(); }).then(function (j) {
      btn.textContent = j && j.ok ? "已装入 ✓" : "失败: " + ((j && j.error) || "未知");
    }).catch(function () { btn.textContent = "网络错误"; btn.disabled = false; });
  });

  document.addEventListener("click", function (e) {
    var toggle = e.target && e.target.closest ? e.target.closest("[data-kp-mermaid-source]") : null;
    if (!toggle) return;
    e.preventDefault();
    var block = toggle.closest ? toggle.closest(".kp-mermaid") : null;
    if (!block) return;
    var source = block.querySelector(".kp-mermaid-source");
    var output = block.querySelector(".kp-mermaid-output");
    var showSource = source.hidden === true;
    source.hidden = !showSource;
    output.hidden = showSource;
    toggle.textContent = showSource ? "查看图表" : "查看源码";
    block.setAttribute("data-kp-mermaid-state", showSource ? "source" : "diagram");
  });

  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-ops-run]") : null;
    if (!btn) return;
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = "启动中…";
    fetch("/api/ops/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: btn.getAttribute("data-project") || currentProjectId(), loopId: btn.getAttribute("data-ops-run") }),
    }).then(function (res) { return res.json(); }).then(function (j) {
      if (j && j.ok) {
        btn.textContent = "已启动 pid " + j.pid;
        return;
      }
      btn.textContent = "失败: " + ((j && j.error) || "未知");
      btn.disabled = false;
    }).catch(function () { btn.textContent = "网络错误"; btn.disabled = false; });
  });

  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest(".kp-copy") : null;
    if (!btn) return;
    e.preventDefault();
    var msg = btn.closest ? btn.closest(".kp-msg") : null;
    var text = msg ? msg.getAttribute("data-copy") || "" : "";
    if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") return;
    try {
      Promise.resolve(navigator.clipboard.writeText(text)).then(function () {
        var oldText = btn.textContent;
        btn.textContent = "已复制";
        setTimeout(function () { btn.textContent = oldText; }, 1200);
      }).catch(function () {});
    } catch (_err) {}
  });

  document.addEventListener("click", function (e) {
    var copy = e.target && e.target.closest ? e.target.closest(".kp-code-copy") : null;
    if (copy) {
      e.preventDefault();
      var copyBlock = copy.closest ? copy.closest(".kp-code-block") : null;
      var code = copyBlock ? copyBlock.querySelector("pre code") : null;
      if (!code || typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") return;
      try {
        Promise.resolve(navigator.clipboard.writeText(code.textContent || "")).then(function () {
          var oldText = copy.textContent;
          copy.textContent = "已复制";
          setTimeout(function () { copy.textContent = oldText; }, 1200);
        }).catch(function () {});
      } catch (_error) {}
      return;
    }

    var toggle = e.target && e.target.closest ? e.target.closest(".kp-code-toggle") : null;
    if (!toggle) return;
    e.preventDefault();
    var block = toggle.closest ? toggle.closest(".kp-code-block") : null;
    if (!block) return;
    var expanded = block.classList.toggle("kp-code-expanded");
    toggle.textContent = expanded ? "收起" : "展开";
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  });

  var kpSelectionActions = null;
  var kpSelectionMessage = null;
  var kpSelectionText = "";

  function kpInsertQuotedText(input, text) {
    if (!input) return;
    var quoted = "> " + String(text == null ? "" : text) + "\\n\\n";
    input.value = quoted + input.value;
    try {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (_error) {
      var inputEvent = document.createEvent("Event");
      inputEvent.initEvent("input", true, false);
      input.dispatchEvent(inputEvent);
    }
    input.focus();
    if (typeof input.setSelectionRange === "function") {
      var end = input.value.length;
      input.setSelectionRange(end, end);
    }
  }

  function kpHideSelectionActions() {
    if (kpSelectionActions) kpSelectionActions.hidden = true;
    kpSelectionMessage = null;
    kpSelectionText = "";
  }

  function kpCopySelectionText(text) {
    if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") return;
    try { Promise.resolve(navigator.clipboard.writeText(text)).catch(function () {}); } catch (_error) {}
  }

  function kpEnsureSelectionActions() {
    if (kpSelectionActions) return kpSelectionActions;
    var style = document.createElement("style");
    style.id = "kp-sel-actions-style";
    style.textContent = ".kp-sel-actions{position:fixed;z-index:10020;display:flex;align-items:center;gap:4px;padding:4px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);transform:translateX(-50%)}.kp-sel-actions[hidden]{display:none}.kp-sel-actions .b{white-space:nowrap}";
    document.head.appendChild(style);
    var actions = document.createElement("div");
    actions.className = "kp-sel-actions";
    actions.setAttribute("role", "toolbar");
    actions.setAttribute("aria-label", "选中文本操作");
    actions.hidden = true;
    var followup = document.createElement("button");
    followup.type = "button";
    followup.className = "b gh";
    followup.setAttribute("data-kp-selection-followup", "");
    followup.textContent = "💬 就这段追问";
    var copy = document.createElement("button");
    copy.type = "button";
    copy.className = "b gh";
    copy.setAttribute("data-kp-selection-copy", "");
    copy.textContent = "📋 复制";
    actions.appendChild(followup);
    actions.appendChild(copy);
    actions.addEventListener("click", function (event) {
      var target = event.target;
      var follow = target && target.closest ? target.closest("[data-kp-selection-followup]") : null;
      var copyAction = target && target.closest ? target.closest("[data-kp-selection-copy]") : null;
      if (!follow && !copyAction) return;
      event.preventDefault();
      event.stopPropagation();
      var selectedText = kpSelectionText;
      var selectedMessage = kpSelectionMessage;
      if (follow && selectedMessage) {
        var selectedWindow = selectedMessage.closest ? selectedMessage.closest(".kp-win") : null;
        var selectedInput = selectedWindow && selectedWindow.querySelector ? selectedWindow.querySelector(".kp-win-input") : null;
        kpInsertQuotedText(selectedInput, selectedText);
      }
      if (copyAction) kpCopySelectionText(selectedText);
      kpHideSelectionActions();
    });
    document.body.appendChild(actions);
    kpSelectionActions = actions;
    return actions;
  }

  function kpElementForSelectionNode(node) {
    if (!node) return null;
    return node.nodeType === 1 ? node : node.parentElement;
  }

  function kpRefreshSelectionActions() {
    if (!window.getSelection) { kpHideSelectionActions(); return; }
    var active = document.activeElement;
    if (active && active.tagName === "TEXTAREA") { kpHideSelectionActions(); return; }
    if (kpSelectionActions && active && kpSelectionActions.contains(active)) return;
    var selection = window.getSelection();
    if (!selection || selection.rangeCount < 1 || selection.isCollapsed) { kpHideSelectionActions(); return; }
    var anchorElement = kpElementForSelectionNode(selection.anchorNode);
    var focusElement = kpElementForSelectionNode(selection.focusNode);
    if (!anchorElement || !focusElement || anchorElement.closest("textarea") || focusElement.closest("textarea")) {
      kpHideSelectionActions();
      return;
    }
    var anchorMessage = anchorElement.closest(".kp-msg");
    var focusMessage = focusElement.closest(".kp-msg");
    var selectedText = selection.toString();
    if (!anchorMessage || anchorMessage !== focusMessage || selectedText.length < 4) {
      kpHideSelectionActions();
      return;
    }
    var range = selection.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    var actions = kpEnsureSelectionActions();
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 320;
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 240;
    var left = rect.left + rect.width / 2;
    actions.style.left = Math.max(88, Math.min(viewportWidth - 88, left)) + "px";
    actions.style.top = Math.max(8, Math.min(viewportHeight - 48, rect.bottom + 8)) + "px";
    kpSelectionMessage = anchorMessage;
    kpSelectionText = selectedText;
    actions.hidden = false;
  }

  document.addEventListener("mouseup", function (event) {
    if (kpSelectionActions && kpSelectionActions.contains(event.target)) return;
    setTimeout(kpRefreshSelectionActions, 0);
  });
  document.addEventListener("selectionchange", kpRefreshSelectionActions);
  document.addEventListener("click", function (event) {
    if (!kpSelectionActions || kpSelectionActions.hidden || kpSelectionActions.contains(event.target)) return;
    kpHideSelectionActions();
  });
  document.addEventListener("scroll", kpHideSelectionActions, true);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") kpHideSelectionActions();
  });
  window.addEventListener("blur", kpHideSelectionActions);

  function escHtml(value) {
    return String(value == null ? "" : value).replace(/[<>&"]/g, function (ch) {
      return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[ch] || ch;
    });
  }

  function readGateCardData(card) {
    try {
      var data = JSON.parse(card.getAttribute("data-gate-card") || "");
      if (!data || typeof data.id !== "string" || !data.id) return null;
      if (!data.project || typeof data.project.id !== "string" || !data.project.id) return null;
      return data;
    } catch (_error) {
      return null;
    }
  }

  function gateCardText(tag, className, text) {
    var node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function clearGateConfirmation(button) {
    if (!button) return;
    if (button._kpGateConfirmTimer) clearTimeout(button._kpGateConfirmTimer);
    button._kpGateConfirmTimer = 0;
    button.removeAttribute("data-gate-confirm");
    button.textContent = "✅ 批准合并";
    button.classList.remove("kp-gate-confirming");
    button.classList.add("pri");
    button.style.background = "";
    button.style.borderColor = "";
    button.style.color = "";
  }

  function armGateConfirmation(button) {
    button.setAttribute("data-gate-confirm", "1");
    button.textContent = "⚠ 再点一次确认合并到 main";
    button.classList.remove("pri");
    button.classList.add("kp-gate-confirming");
    button.style.background = "var(--warn)";
    button.style.borderColor = "var(--warn)";
    button.style.color = "#fff";
    button._kpGateConfirmTimer = setTimeout(function () {
      clearGateConfirmation(button);
    }, 5000);
  }

  function hydrateGateCards(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("[data-gate-card]").forEach(function (card) {
      if (card.getAttribute("data-gate-hydrated") === "1") return;
      var data = readGateCardData(card);
      card.setAttribute("data-gate-hydrated", "1");
      card.classList.add("kp-gate-card");
      card.textContent = "";
      if (!data) {
        card.appendChild(gateCardText("div", "kp-ev kp-ev-error", "待审门卡片数据无效"));
        return;
      }
      var kind = data.kind === "merge" ? "合并门" : "人工门";
      var projectName = typeof data.project.name === "string" && data.project.name ? data.project.name : data.project.id;
      var branch = typeof data.branch === "string" && data.branch ? data.branch : "无分支";
      var createdAt = typeof data.createdAt === "number" && isFinite(data.createdAt)
        ? new Date(data.createdAt).toLocaleString()
        : "时间未知";
      card.appendChild(gateCardText("div", "kp-loop-copy", kind + " · " + String(data.title || data.id)));
      card.appendChild(gateCardText("div", "kp-ev-usage", projectName + " · " + branch + " · " + createdAt));
      var actions = document.createElement("div");
      actions.className = "acts kp-gate-actions";
      var tier = document.createElement("select");
      tier.className = "kp-gate-tier";
      tier.setAttribute("data-gate-tier", "");
      [["", "这扇门花了我…"], ["short", "≤5 分钟"], ["medium", "5–15 分钟"], ["long", ">15 分钟"]].forEach(function (choice) {
        var option = document.createElement("option");
        option.value = choice[0];
        option.textContent = choice[1];
        tier.appendChild(option);
      });
      actions.appendChild(tier);
      var approve = gateCardText("button", "b pri kp-gate-approve", "✅ 批准合并");
      approve.type = "button";
      approve.setAttribute("data-gate-approve", "");
      var discard = gateCardText("button", "b gh kp-gate-discard", "❌ 驳回");
      discard.type = "button";
      discard.setAttribute("data-gate-discard", "");
      var diff = gateCardText("button", "b gh kp-gate-diff", "🔍 查看改动");
      diff.type = "button";
      diff.setAttribute("data-gate-diff", "");
      actions.appendChild(approve);
      actions.appendChild(discard);
      actions.appendChild(diff);
      card.appendChild(actions);
      var result = gateCardText("div", "kp-ev kp-gate-result", "");
      result.setAttribute("aria-live", "polite");
      card.appendChild(result);
    });
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    var approve = target && target.closest ? target.closest("[data-gate-approve]") : null;
    var discard = target && target.closest ? target.closest("[data-gate-discard]") : null;
    var diff = target && target.closest ? target.closest("[data-gate-diff]") : null;
    var button = approve || discard || diff;
    if (!button) return;
    event.preventDefault();
    var card = button.closest("[data-gate-card]");
    if (!card || card.getAttribute("data-gate-busy") === "1") return;
    var data = readGateCardData(card);
    var result = card.querySelector(".kp-gate-result");
    if (!data || !result) return;
    if (diff) {
      diff.disabled = true;
      diff.textContent = "读取中…";
      result.className = "kp-ev kp-gate-result";
      result.textContent = "读取中…";
      Promise.resolve().then(function () {
        return fetch("/api/gate-diff?projectId=" + encodeURIComponent(data.project.id)
          + "&flowId=" + encodeURIComponent(data.id) + "&target=main");
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (response.ok === false || payload.ok !== true) throw new Error(payload.error || "无法读取改动");
          return payload;
        });
      }).then(function (payload) {
        var diffText = typeof payload.diff === "string" && payload.diff ? payload.diff : "（无 diff）";
        overlayHtml("改动 · " + data.id, kpGateDiffCardHtml(data.id, diffText));
        kpHydrateGateCommentCards(document);
        result.textContent = "";
      }).catch(function (error) {
        result.className = "kp-ev kp-ev-error kp-gate-result";
        result.textContent = error && error.message ? error.message : String(error);
      }).then(function () {
        diff.disabled = false;
        diff.textContent = "🔍 查看改动";
      }, function (error) {
        result.className = "kp-ev kp-ev-error kp-gate-result";
        result.textContent = error && error.message ? error.message : String(error);
        diff.disabled = false;
        diff.textContent = "🔍 查看改动";
      });
      return;
    }
    if (approve && approve.getAttribute("data-gate-confirm") !== "1") {
      armGateConfirmation(approve);
      return;
    }
    var approveButton = approve || card.querySelector("[data-gate-approve]");
    clearGateConfirmation(approveButton);
    var buttons = card.querySelectorAll("[data-gate-approve],[data-gate-discard],[data-gate-diff]");
    card.setAttribute("data-gate-busy", "1");
    buttons.forEach(function (item) { item.disabled = true; item.textContent = "处理中…"; });
    result.className = "kp-ev kp-gate-result";
    result.textContent = "处理中…";
    var url = approve ? "/api/merge" : "/api/gates/discard";
    var body = approve
      ? { projectId: data.project.id, flowId: data.id, target: "main" }
      : { flowId: data.id };
    var tier = card.querySelector("[data-gate-tier]");
    if (tier && tier.value) body.durationTier = tier.value;
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (response.ok === false || payload.ok !== true) throw new Error(payload.error || "请求失败");
        return payload;
      });
    }).then(function () {
      clearGateConfirmation(approveButton);
      card.removeAttribute("data-gate-busy");
      var actions = card.querySelector(".kp-gate-actions");
      if (actions) actions.remove();
      result.className = "kp-ev kp-ev-done kp-gate-result";
      result.textContent = approve ? "已合并 ✓" : "已驳回";
    }).catch(function (error) {
      clearGateConfirmation(approveButton);
      card.removeAttribute("data-gate-busy");
      buttons.forEach(function (item) {
        item.disabled = false;
        item.textContent = item.hasAttribute("data-gate-approve")
          ? "✅ 批准合并"
          : (item.hasAttribute("data-gate-diff") ? "🔍 查看改动" : "❌ 驳回");
      });
      result.className = "kp-ev kp-ev-error kp-gate-result";
      result.textContent = error && error.message ? error.message : String(error);
    });
  });

  hydrateGateCards(document);

  var KW_PALETTE = ["var(--info)","var(--success)","var(--primary)","var(--warn)","var(--danger)","#06b6d4","#ec4899","#14b8a6","#f97316","#6366f1","#84cc16","#0ea5e9","#d946ef","#22c55e"];
  // 每个词按其文字哈希取一种颜色,词云更缤纷;分类只作次选种子。
  function kwColor(cat, tag){
    var key = String(tag || cat || "");
    var h = 0;
    for (var i = 0; i < key.length; i++) { h = (h * 31 + key.charCodeAt(i)) >>> 0; }
    return KW_PALETTE[h % KW_PALETTE.length];
  }

  function normalizeHash(hash) {
    if (hash === "#/overview" || hash === "#/workbench" || hash === "#/inbox" || hash === legacyReviewInboxRoute || hash === "#/evolution" || hash === "#/architecture" || hash === "#/terminal" || hash === "#/settings" || hash === "#/loops" || hash === "#/insights" || hash === "#/tasks" || hash === "#/library" || hash === "#/knowledge" || hash === "#/solutions" || hash === "#/docs" || hash === "#/skills" || hash === "#/switchboard" || hash === "#/register-project") return hash;
    if (/^#\\/project\\/[^/]+(\\/[^/]+)?$/.test(hash || "")) return hash;
    return "#/workbench";
  }

  function currentRoute() {
    return normalizeHash(window.location.hash || "#/workbench");
  }

  var KP_SELF_PROJECT_ID = "kunpeng";

  function currentProjectId() {
    var match = /^#\\/project\\/([^/]+)/.exec(window.location.hash || "");
    if (match) return decodeURIComponent(match[1]);
    // 默认工作区取鲲鹏本体，不是注册表里排第一的项目。
    var selfProject = latestState && latestState.projects
      ? latestState.projects.find(function (project) { return project.id === KP_SELF_PROJECT_ID; })
      : null;
    if (selfProject) return selfProject.id;
    if (latestState && latestState.projects && latestState.projects[0] && latestState.projects[0].id) {
      return latestState.projects[0].id;
    }
    return "current";
  }

  function setTheme(value) {
    var v = String(value || "");
    if (!v) return;
    document.documentElement.setAttribute("data-theme", v);
    syncThemeColor(v);
    try {
      localStorage.setItem("kpTheme", v);
    } catch (_err) {}
  }

  function syncThemeColor(value) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", value === "dark" ? "#22B8D4" : "#8D4B00");
  }

  function loadTheme() {
    try {
      var v = localStorage.getItem("kpTheme");
      if (v) {
        document.documentElement.setAttribute("data-theme", v);
        syncThemeColor(v);
      }
    } catch (_err) {}
  }

  function readProjects(state) {
    var source = state && state.projects;
    if (Array.isArray(source)) {
      return source.map(function (p) {
        var id = p && (p.id || p.projectId || p.name);
        return { id: String(id || "current"), name: String((p && (p.name || p.id || p.projectId)) || id || "current") };
      });
    }
    if (source && typeof source === "object") {
      return Object.keys(source).map(function (id) {
        var p = source[id] || {};
        return { id: String(id), name: String(p.name || p.id || id) };
      });
    }
    return [{ id: "current", name: "current" }];
  }

`;
