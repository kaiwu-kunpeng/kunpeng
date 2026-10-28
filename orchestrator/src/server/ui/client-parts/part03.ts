export const part03: string = `  function kpReconnectDecide(stamps, now, windowMs, delays) {
    var nextStamps = stamps.filter(function (stamp) { return stamp > now - windowMs; }).concat([now]);
    if (delays.length === 0) return { allow: false, delayMs: 0, stamps: nextStamps };
    var allow = nextStamps.length <= delays.length;
    var delayIndex = Math.min(nextStamps.length - 1, delays.length - 1);
    return { allow: allow, delayMs: delays[delayIndex], stamps: nextStamps };
  }

  function kpChatFailureHandle(status, errorCode, actions) {
    if (status === 403) {
      if (String(errorCode || "").indexOf("act mode requires owner role") >= 0) {
        actions.showError("当前账号只能用只读的 Plan 模式，请切到 Plan 或让 owner 升权");
      } else {
        actions.showError("当前账号无权访问该项目，请联系 owner 授权");
      }
      actions.finish(true);
      return;
    }
    if (status === 401) {
      actions.showError("登录已失效，请重新登录");
      actions.finish(true);
      return;
    }
    if (status === 409) { actions.showError("本会话上一轮仍在生成中（可能是别的标签页或设备发起的），已接回它的输出；这条消息未发出，等它结束或先停止再发"); actions.reconnect(); return; }
    actions.reconnect();
  }

  function kpStopConfirm(state, now, setState, stop, label, schedule, cancel) {
    if (state.timer != null) cancel(state.timer);
    if (state.until > now) { stop(); return { until: 0, timer: null }; }
    setState(label);
    var next = { until: now + 1500, timer: null };
    next.timer = schedule(function () { next.until = 0; next.timer = null; setState("运行中"); }, 1500);
    return next;
  }

  function bindWorkbench() {
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }
    function localfsDbOpen(cb) {
      try {
        var req = indexedDB.open("kp-localfs", 2);
        req.onupgradeneeded = function () {
          try {
            if (!req.result.objectStoreNames.contains("dirs")) req.result.createObjectStore("dirs");
          } catch (_e) {}
        };
        req.onsuccess = function () { cb(req.result); };
        req.onerror = function () { cb(null); };
      } catch (_e) { cb(null); }
    }
    function localfsCurrentUsername() {
      var user = document.querySelector(".kp-user");
      if (!user) return "";
      return String(user.textContent || "").replace(/^\uD83D\uDC64\\s*/, "").trim();
    }
    function localfsConversationKey(username, conv) {
      return username && conv ? username + "::" + conv : "";
    }
    function localfsIsLegacyConversationKey(key) {
      return key === "global" || key.indexOf("conv:") === 0;
    }
    function localfsClientId() {
      try {
        var k = "kp-localfs-client";
        var v = localStorage.getItem(k);
        if (!v) {
          v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
          localStorage.setItem(k, v);
        }
        return v;
      } catch (_e) { return ""; }
    }
    function localfsSaveHandle(h, conv) {
      var key = localfsConversationKey(localfsCurrentUsername(), conv);
      if (!key) return;
      localfsDbOpen(function (db) {
        if (!db) return;
        try { db.transaction("dirs","readwrite").objectStore("dirs").put(h, key); } catch (_e) {}
      });
    }
    function localfsLoadHandle(conv, cb) {
      var username = localfsCurrentUsername();
      var key = localfsConversationKey(username, conv);
      if (!key) { cb(null, false); return; }
      localfsDbOpen(function (db) {
        if (!db) { cb(null, false); return; }
        try {
          var handle = null;
          var hasOtherConversation = false;
          var finished = false;
          var tx = db.transaction("dirs","readonly");
          var store = tx.objectStore("dirs");
          var getReq = store.get(key);
          var cursorReq = store.openKeyCursor();
          function finish(h, other) { if (finished) return; finished = true; cb(h, other); }
          getReq.onsuccess = function () { handle = getReq.result || null; };
          cursorReq.onsuccess = function () {
            var cursor = cursorReq.result;
            if (!cursor) return;
            var cursorKey = String(cursor.key || "");
            // 旧 key 没有账号归属，必须明确忽略，不能迁移或复用。
            if (localfsIsLegacyConversationKey(cursorKey)) { cursor.continue(); return; }
            if (cursorKey.indexOf(username + "::") === 0 && cursorKey !== key) hasOtherConversation = true;
            cursor.continue();
          };
          tx.oncomplete = function () { finish(handle, hasOtherConversation); };
          tx.onerror = function () { finish(null, false); };
          tx.onabort = function () { finish(null, false); };
        } catch (_e) { cb(null, false); }
      });
    }
    function localfsForgetHandle(conv, cb) {
      var key = localfsConversationKey(localfsCurrentUsername(), conv);
      if (!key) { if (cb) cb(); return; }
      localfsDbOpen(function (db) {
        if (!db) { if (cb) cb(); return; }
        try {
          var req = db.transaction("dirs","readwrite").objectStore("dirs").delete(key);
          req.onsuccess = function () { if (cb) cb(); };
          req.onerror = function () { if (cb) cb(); };
        } catch (_e) { if (cb) cb(); }
      });
    }
    // 贴底判定:只有用户本来就在底部附近时才自动跟滚;往上翻阅历史时绝不拽回底部。
    function nearBottom(logEl) { return logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 90; }
    function notifyChatProjection(logEl) {
      var projectionWin = logEl && logEl.closest ? logEl.closest(".kp-win[data-kind=chat]") : null;
      if (projectionWin) projectionWin.dispatchEvent(new CustomEvent("kp:chat-projection-change"));
    }
    function appendLine(logEl, html) {
      if (!logEl) return;
      var empty = logEl.querySelector(".kp-stream-empty");
      if (empty) empty.remove();
      var stick = nearBottom(logEl);
      logEl.insertAdjacentHTML("beforeend", html);
      notifyChatProjection(logEl);
      if (stick) logEl.scrollTop = logEl.scrollHeight;
    }
    function kpUsageFromElement(element) {
      if (!element) return null;
      var text = String(element.textContent || "");
      var inputMatch = text.match(/in\\s+(\\d+)/);
      var parts = text.split("\\u00B7");
      var dataInput = element.getAttribute("data-input");
      var dataCacheCreate = element.getAttribute("data-cache-create");
      var dataCacheRead = element.getAttribute("data-cache-read");
      var dataModel = element.getAttribute("data-model");
      return {
        input: dataInput === null ? (inputMatch ? Number(inputMatch[1]) : 0) : Number(dataInput),
        cacheCreate: dataCacheCreate === null ? 0 : Number(dataCacheCreate),
        cacheRead: dataCacheRead === null ? 0 : Number(dataCacheRead),
        model: dataModel === null ? String(parts[1] || "").trim() : dataModel
      };
    }
    function kpHideContextMeter(win) {
      var meter = win && win.querySelector ? win.querySelector(".kp-ctx-meter") : null;
      if (!meter) return;
      meter.hidden = true;
      meter.removeAttribute("title");
      var fill = meter.querySelector(".kp-ctx-meter-fill");
      if (fill) fill.style.width = "0%";
    }
    function kpResetContextMeter(win) {
      kpHideContextMeter(win);
      if (win) win.removeAttribute("data-kp-ctx-warned");
    }
    function kpUpdateContextMeter(win, usage) {
      if (!win || !usage) { kpHideContextMeter(win); return; }
      var meter = win.querySelector(".kp-ctx-meter");
      var fill = meter && meter.querySelector(".kp-ctx-meter-fill");
      if (!meter || !fill) return;
      var estimate = kpCtxEstimate(usage);
      var percentage = Math.round(estimate.ratio * 100);
      fill.style.width = Math.max(0, Math.min(100, estimate.ratio * 100)) + "%";
      meter.hidden = false;
      meter.title = "\\u4E0A\\u4E0B\\u6587\\u7EA6 " + percentage + "% (" + estimate.used + "/" + estimate.window + " tokens)";
      meter.classList.remove("act", "roll", "blk", "kp-ctx-normal", "kp-ctx-warning", "kp-ctx-danger");
      if (estimate.ratio < 0.6) meter.classList.add("act", "kp-ctx-normal");
      else if (estimate.ratio <= 0.85) meter.classList.add("roll", "kp-ctx-warning");
      else meter.classList.add("blk", "kp-ctx-danger");
      if (estimate.ratio > 0.85 && win.getAttribute("data-kp-ctx-warned") !== "true") {
        win.setAttribute("data-kp-ctx-warned", "true");
        // 锁定话术:上下文已用约 85%+:可发 /compact 压缩本会话,或 /capture 沉淀要点后另开新会话
        appendLine(win.querySelector(".kp-win-log"), '<div class="kp-ev kp-ctx-warning-note">\\u4E0A\\u4E0B\\u6587\\u5DF2\\u7528\\u7EA6 85%+\\uFF1A\\u53EF\\u53D1 /compact \\u538B\\u7F29\\u672C\\u4F1A\\u8BDD\\uFF0C\\u6216 /capture \\u6C89\\u6DC0\\u8981\\u70B9\\u540E\\u53E6\\u5F00\\u65B0\\u4F1A\\u8BDD</div>');
      }
    }
    function fmtTok(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace(/\\.0$/, "") + "k tokens" : n + " tokens"; }
    function updateTokens(logEl, counterEl) {
      if (!logEl || !counterEl) return;
      var total = 0;
      logEl.querySelectorAll(".kp-ev-usage").forEach(function (u) {
        var m = u.textContent.match(/in\\s+(\\d+)\\s*\\/\\s*out\\s+(\\d+)/);
        if (m) total += (parseInt(m[1], 10) || 0) + (parseInt(m[2], 10) || 0);
      });
      counterEl.textContent = fmtTok(total);
    }
    // 终端式活动行:显示「<label> 运行中 · X.Xs」实时秒表,结束变「✓ 完成 · X.Xs」
    function startActivity(logEl, label) {
      var empty = logEl.querySelector(".kp-stream-empty"); if (empty) empty.remove();
      var t0 = Date.now();
      var el = document.createElement("div");
      el.className = "kp-ev kp-ev-stage";
      var stick = nearBottom(logEl);
      logEl.appendChild(el); if (stick) logEl.scrollTop = logEl.scrollHeight;
      notifyChatProjection(logEl);
      function tick() { el.textContent = label + " 运行中 · " + ((Date.now() - t0) / 1000).toFixed(1) + "s"; }
      tick();
      var timer = setInterval(tick, 200);
      return function finish(aborted, stoppedByUser) {
        clearInterval(timer);
        var secs = ((Date.now() - t0) / 1000).toFixed(1);
        el.className = "kp-ev " + (aborted && !stoppedByUser ? "kp-ev-error" : "kp-ev-done");
        el.textContent = label + (stoppedByUser ? " 已停止 · " : aborted ? " 已中断 · " : " 完成 · ") + secs + "s";
        notifyChatProjection(logEl);
      };
    }
    // 通用:把一个 SSE 流灌进 logEl,并实时更新 token 计数;登记进 wbStreams 便于切走时统一关闭
    function openStream(url, logEl, counterEl, onDone, requestBody) {
      function appendStreamFailure() {
        if (!logEl) return;
        var streamWin = logEl.closest ? logEl.closest(".kp-win") : null;
        var retry = streamWin && streamWin.__kpLastRun
          ? ' <button type="button" class="b gh kp-stream-retry" data-kp-retry>↻ 重试</button>'
          : "";
        logEl.insertAdjacentHTML("beforeend", '<div class="kp-ev kp-ev-error kp-stream-error">连接中断，流未正常结束' + retry + '</div>');
        notifyChatProjection(logEl);
        logEl.scrollTop = logEl.scrollHeight;
      }
      function deliver(data) {
        if (!logEl) return;
        var tmp = document.createElement("div");
        tmp.innerHTML = data;
        var contextUsages = [];
        tmp.querySelectorAll(".kp-ev-usage").forEach(function (usageElement) {
          var usage = kpUsageFromElement(usageElement);
          if (usage) contextUsages.push(usage);
        });
        var conv = tmp.querySelector(".kp-localfs-conv[data-conv]");
        if (conv) {
          var convId = conv.getAttribute("data-conv") || "";
          var streamWin = logEl.closest ? logEl.closest(".kp-win") : null;
          if (streamWin && convId && streamWin.getAttribute("data-conv") !== convId) {
            streamWin.setAttribute("data-conv", convId);
            streamWin.dispatchEvent(new CustomEvent("kp:conversation-changed"));
          }
        }
        var upd = tmp.querySelector(".kp-tool-upd[data-tool-id]");
        if (upd) {
          var tid = upd.getAttribute("data-tool-id");
          var ok = upd.getAttribute("data-ok") === "1";
          var card = tid ? logEl.querySelector('.kp-tool[data-tool-id="' + tid + '"]') : null;
          if (card) {
            card.className = "kp-ev kp-tool " + (ok ? "kp-tool-ok" : "kp-tool-err");
            var ic = card.querySelector(".kp-tool-ic"); if (ic) ic.textContent = ok ? "✓" : "✗";
            var st = card.querySelector(".kp-tool-st"); if (st) st.textContent = ok ? "完成" : "失败";
          }
          return;
        }
        var argProgress = tmp.querySelector(".kp-tool-arg[data-chars]");
        if (argProgress) {
          var chars = Number(argProgress.getAttribute("data-chars"));
          var toolCards = logEl.querySelectorAll(".kp-tool");
          var activeToolCard = null;
          for (var toolIndex = toolCards.length - 1; toolIndex >= 0; toolIndex -= 1) {
            var toolCard = toolCards[toolIndex];
            if (toolCard.className.indexOf("kp-tool-ok") === -1 && toolCard.className.indexOf("kp-tool-err") === -1) {
              activeToolCard = toolCard;
              break;
            }
          }
          if (activeToolCard) {
            var toolStatus = activeToolCard.querySelector(".kp-tool-st");
            var readableChars = chars >= 10000 ? (chars / 10000).toFixed(1) + " 万字符" : chars + " 字符";
            if (toolStatus) toolStatus.textContent = "执行中… 已生成 " + readableChars;
          }
          return;
        }
        var stick = nearBottom(logEl);
        logEl.insertAdjacentHTML("beforeend", data);
        hydrateGateCards(logEl);
        notifyChatProjection(logEl);
        if (stick) logEl.scrollTop = logEl.scrollHeight;
        updateTokens(logEl, counterEl);
        var contextWin = logEl.closest ? logEl.closest(".kp-win[data-kind=chat]") : null;
        contextUsages.forEach(function (usage) { kpUpdateContextMeter(contextWin, usage); });
      }
      if (requestBody) {
        var controller = new AbortController();
        var fetchEnded = false;
        var fetchClosed = false;
        var lastSeq = 0;
        var reconnectStamps = [];
        var reconnectTimer = null;
        var reconnectStatus = null;
        var reconnecting = false;
        var reconnectWindowMs = 120000;
        var reconnectDelays = [1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000];
        function clearReconnectStatus() {
          if (reconnectStatus && reconnectStatus.parentNode) reconnectStatus.parentNode.removeChild(reconnectStatus);
          reconnectStatus = null;
          notifyChatProjection(logEl);
        }
        function clearReconnectTimer() {
          if (reconnectTimer != null) clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        function showReconnectStatus(attempt) {
          if (!logEl) return;
          if (!reconnectStatus) {
            reconnectStatus = document.createElement("div");
            reconnectStatus.className = "kp-ev kp-ev-stage kp-stream-reconnect";
            var stick = nearBottom(logEl);
            logEl.appendChild(reconnectStatus);
            if (stick) logEl.scrollTop = logEl.scrollHeight;
          }
          reconnectStatus.textContent = "连接中断，正在自动重连(第" + attempt + "次)…";
          notifyChatProjection(logEl);
        }
        var handle = {
          close: function () {
            fetchClosed = true;
            reconnecting = false;
            clearReconnectTimer();
            clearReconnectStatus();
            try { controller.abort(); } catch (_e) {}
            var i = wbStreams.indexOf(handle); if (i >= 0) wbStreams.splice(i, 1);
          },
          isReconnecting: function () { return reconnecting && !fetchEnded && !fetchClosed; }
        };
        wbStreams.push(handle);
        function fetchCleanup() { var i = wbStreams.indexOf(handle); if (i >= 0) wbStreams.splice(i, 1); }
        function fetchFinish(errored, conversationReloaded) {
          if (fetchEnded || fetchClosed) return;
          fetchEnded = true;
          reconnecting = false;
          clearReconnectTimer();
          clearReconnectStatus();
          fetchCleanup();
          if (onDone) onDone(!!errored, !!conversationReloaded);
        }
        function consumeSseBlock(block) {
          var lines = block.split("\\n");
          var eventName = "message";
          var dataLines = [];
          lines.forEach(function (line) {
            if (line.indexOf("event:") === 0) eventName = line.slice(6).trim();
            else if (line.indexOf("data:") === 0) dataLines.push(line.slice(5).replace(/^ /, ""));
            else if (line.indexOf("id:") === 0) {
              var seqText = line.slice(3).trim();
              if (/^\\d+$/.test(seqText)) lastSeq = Math.max(lastSeq, parseInt(seqText, 10));
            }
          });
          if (eventName === "end") { fetchFinish(false); return; }
          if (eventName === "message" && dataLines.length) deliver(dataLines.join("\\n"));
        }
        function consumeSseResponse(response) {
          var reader = response.body.getReader();
          var decoder = new TextDecoder();
          var buffer = "";
          function pump() {
            return reader.read().then(function (part) {
              if (part.done) {
                buffer += decoder.decode();
                if (buffer.trim()) consumeSseBlock(buffer);
                return !fetchEnded && !fetchClosed;
              }
              buffer += decoder.decode(part.value, { stream: true });
              buffer = buffer.replace(/\\r\\n/g, "\\n");
              var boundary;
              while ((boundary = buffer.indexOf("\\n\\n")) >= 0) {
                consumeSseBlock(buffer.slice(0, boundary));
                buffer = buffer.slice(boundary + 2);
              }
              if (!fetchEnded && !fetchClosed) return pump();
              return false;
            });
          }
          return pump();
        }
        function exhaustReconnects() {
          if (fetchEnded || fetchClosed) return;
          reconnecting = false;
          clearReconnectTimer();
          clearReconnectStatus();
          appendStreamFailure();
          fetchFinish(true);
        }
        function scheduleReconnect() {
          if (fetchEnded || fetchClosed) return;
          var reconnectDecision = kpReconnectDecide(reconnectStamps, Date.now(), reconnectWindowMs, reconnectDelays);
          reconnectStamps = reconnectDecision.stamps;
          if (!reconnectDecision.allow) { exhaustReconnects(); return; }
          reconnecting = true;
          showReconnectStatus(reconnectStamps.length);
          reconnectTimer = setTimeout(function () {
            reconnectTimer = null;
            if (fetchEnded || fetchClosed) return;
            var streamWin = logEl && logEl.closest ? logEl.closest(".kp-win") : null;
            var wsId = currentProjectId();
            var convId = streamWin && streamWin.getAttribute ? streamWin.getAttribute("data-conv") || "" : "";
            fetch("/api/workspace/" + encodeURIComponent(wsId) + "/chat/attach?conv=" + encodeURIComponent(convId) + "&after=" + encodeURIComponent(String(lastSeq)), {
              method: "GET",
              signal: controller.signal
            }).then(function (response) {
              if (response.status === 204) {
                clearReconnectStatus();
                if (streamWin) reloadConversationWindow(streamWin);
                fetchFinish(false, true);
                return false;
              }
              if (response.status !== 200 || !response.body) throw new Error("chat attach HTTP " + response.status);
              clearReconnectStatus();
              return consumeSseResponse(response);
            }).then(function (disconnected) {
              if (disconnected && !fetchEnded && !fetchClosed) scheduleReconnect();
            }).catch(function () {
              if (!fetchEnded && !fetchClosed) scheduleReconnect();
            });
          }, reconnectDecision.delayMs);
        }
        var chatFailureActions = {
          showError: function (message) {
            if (!logEl) return;
            var errorEl = document.createElement("div");
            errorEl.className = "kp-ev kp-ev-error kp-chat-denied";
            errorEl.textContent = message;
            logEl.appendChild(errorEl);
            notifyChatProjection(logEl);
            logEl.scrollTop = logEl.scrollHeight;
          },
          reconnect: scheduleReconnect,
          finish: fetchFinish
        };
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }).then(function (response) {
          if (response.ok && response.body) return consumeSseResponse(response);
          // chat stream HTTP failures must preserve their status/body before deciding whether to reconnect.
          if (response.ok) {
            kpChatFailureHandle(response.status, "", chatFailureActions);
            return false;
          }
          return response.text().catch(function () { return ""; }).then(function (body) {
            var errorCode = "";
            try {
              var parsedError = JSON.parse(body);
              errorCode = parsedError && typeof parsedError.error === "string" ? parsedError.error : "";
            } catch (_e) {}
            kpChatFailureHandle(response.status, errorCode, chatFailureActions);
            return false;
          });
        }).then(function (disconnected) {
          if (disconnected && !fetchEnded && !fetchClosed) scheduleReconnect();
        }).catch(function () {
          if (!fetchClosed && !fetchEnded) {
            kpChatFailureHandle(0, "", chatFailureActions);
          }
        });
        return handle;
      }
      if (!window.EventSource) return null;
      var es = new EventSource(url);
      var ended = false;
      wbStreams.push(es);
      function cleanup() { try { es.close(); } catch (_e) {} var i = wbStreams.indexOf(es); if (i >= 0) wbStreams.splice(i, 1); }
      es.onmessage = function (e) { deliver(e.data); };
      es.addEventListener("end", function () { ended = true; cleanup(); if (onDone) onDone(false); });
      es.onerror = function () {
        if (ended) { cleanup(); return; }
        ended = true;
        appendStreamFailure();
        cleanup();
        if (onDone) onDone(true);
      };
      return es;
    }

    var winHost = document.getElementById("kp-windows");
    if (!winHost) return;
    var convList = document.getElementById("kp-conv-list");
    var convSearch = document.getElementById("kp-conv-search");
    if (convSearch) convSearch.setAttribute("placeholder", "搜索会话…");
    if (!document.getElementById("kp-conv-pin-style")) {
      var convPinStyle = document.createElement("style");
      convPinStyle.id = "kp-conv-pin-style";
      convPinStyle.textContent = ".kp-conv-pin{right:68px;pointer-events:none}.kp-conv-fork{right:47px}.kp-conv-item:hover .kp-conv-pin,.kp-conv-item[data-pin-revealed=true] .kp-conv-pin{opacity:1;pointer-events:auto}.kp-mobile-touch-target{min-width:44px;min-height:44px}.kp-quick-bar{display:flex;gap:6px;overflow-x:auto;width:100%;max-width:100%;min-width:0;box-sizing:border-box;margin:0 0 6px;scrollbar-width:thin}.kp-example{font:inherit;font-size:12px;text-align:left;line-height:1.35;padding:5px 8px;white-space:nowrap;flex:0 0 auto;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);cursor:pointer}.kp-example:hover,.kp-example:focus-visible{border-color:var(--primary);outline:none;background:var(--line-2)}.kp-stream-retry{margin-left:8px}";
      document.head.appendChild(convPinStyle);
    }
    var conversationArchiveView = false;
    var conversationListRequest = 0;
    var convArchiveToggle = null;
    var KP_MAX_WINDOWS = 12;
    if (convList) {
      var convSide = convList.closest ? convList.closest(".kp-wb-side") : null;
      var convHeader = convSide && convSide.querySelector ? convSide.querySelector(".kp-wb-brand") : null;
      if (convHeader) {
        convArchiveToggle = document.createElement("button");
        convArchiveToggle.type = "button";
        convArchiveToggle.className = "b gh";
        convArchiveToggle.textContent = "归档";
        convArchiveToggle.setAttribute("aria-label", "查看归档会话");
        convHeader.appendChild(convArchiveToggle);
      }
    }
    var seq = 0;
    var openingConvs = {};
    function uid() { return "w" + Date.now().toString(36) + (seq++); }
    function windowTitleValue(kind, title) {
      var value = String(title || "").trim();
      return value || (kind === "chat" ? "对话" : "任务");
    }
    function shortWindowTitle(title) {
      return title.length > 28 ? title.slice(0, 28) + "…" : title;
    }
    function syncWindowTitle(win, kind, title) {
      var titleEl = win && win.querySelector ? win.querySelector(".kp-term-title") : null;
      if (!titleEl) return;
      var fullTitle = windowTitleValue(kind, title);
      var textEl = titleEl.querySelector(".kp-term-title-text");
      if (!textEl) {
        textEl = document.createElement("span");
        textEl.className = "kp-term-title-text";
        titleEl.appendChild(textEl);
      }
      textEl.textContent = shortWindowTitle(fullTitle);
      titleEl.setAttribute("title", fullTitle);
    }
    function convGroupLabel(updatedAt) {
      var d = new Date(updatedAt || Date.now());
      var now = new Date();
      var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      var t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      if (t >= startToday) return "今天";
      if (t >= startToday - 86400000) return "昨天";
      return "更早";
    }
    function convTime(updatedAt) {
      var ts = Number(updatedAt || 0);
      if (!ts) return "";
      var diff = Math.max(0, Date.now() - ts);
      if (diff < 60000) return "刚刚";
      if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
      if (diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
      return new Date(ts).toLocaleDateString();
    }
    function chatEmptyStateHtml() {
      return '<div class="kp-stream-empty">▸ <b>直接打字对话</b>,回车发送。右上角切模型。输入 <b>/</b> 查看聊天命令。</div>';
    }
    function renderConversationTurns(win, conversation) {
      var log = win && win.querySelector(".kp-win-log");
      if (!log) return;
      log.innerHTML = "";
      var turns = conversation && Array.isArray(conversation.turns) ? conversation.turns : [];
      if (!turns.length) {
        log.innerHTML = chatEmptyStateHtml();
        kpHideContextMeter(win);
        return;
      }
      var latestUsage = null;
      var lastUserIndex = -1;
      var lastAssistantIndex = -1;
      for (var i = turns.length - 1; i >= 0; i--) {
        if (turns[i] && turns[i].kind === "peer") continue;
        if (lastAssistantIndex < 0 && turns[i] && turns[i].role === "assistant") lastAssistantIndex = i;
        if (lastUserIndex < 0 && turns[i] && turns[i].role === "user") lastUserIndex = i;
        if (lastUserIndex >= 0 && lastAssistantIndex >= 0) break;
      }
      var lastUserText = lastUserIndex >= 0 && turns[lastUserIndex] ? String(turns[lastUserIndex].text || "") : "";
      turns.forEach(function (turn, index) {
        if (turn && turn.kind === "peer") {
          appendLine(log, '<div class="kp-ev kp-ev-stage kp-peer">' + esc(turn && turn.text ? turn.text : "") + '</div>');
          return;
        }
        var text = esc(turn && turn.text ? turn.text : "");
        if (turn && turn.role === "user") {
          var editAction = index === lastUserIndex
            ? '<button class="b gh kp-chat-edit" type="button" data-chat-edit data-user-text="' + escAttr(turn.text || "") + '">编辑</button>'
            : "";
          appendLine(log, '<div class="kp-chat-me" data-copy="' + escAttr(turn.text || "") + '">' + text + editAction + '</div>');
        }
        else {
          var regenerateAction = index === lastAssistantIndex
            ? '<button class="b gh kp-regen" type="button" data-chat-regenerate data-user-text="' + escAttr(lastUserText) + '">重新生成</button>'
            : "";
          var quoteAction = '<button class="b gh kp-quote" type="button" data-chat-quote>引用</button>';
          appendLine(log, '<div class="kp-ev kp-ev-token kp-msg" data-copy="' + escAttr(turn && turn.text ? turn.text : "") + '">' + text + '<button class="kp-copy" type="button" title="复制" aria-label="复制">复制</button>' + quoteAction + regenerateAction + '</div>');
          if (turn && turn.usage) latestUsage = turn.usage;
          if (turn && turn.usage && (turn.usage.input || turn.usage.output)) appendLine(log, '<div class="kp-ev kp-ev-usage">in ' + (turn.usage.input || 0) + ' / out ' + (turn.usage.output || 0) + (turn.usage.model ? ' \\u00B7 ' + esc(turn.usage.model) : '') + ' \\u00B7 $' + kpCostUsd(turn.usage.model, (turn.usage.input || 0) + (turn.usage.output || 0)).toFixed(4) + '</div>');
          var alternatives = turn && Array.isArray(turn.alternatives) ? turn.alternatives : [];
          if (alternatives.length) {
            appendLine(log, '<details class="kp-chat-alternatives"><summary>历史回复 ' + alternatives.length + '</summary>'
              + alternatives.map(function (alternative) { return '<div class="kp-ev kp-chat-alternative">' + esc(alternative && alternative.text ? alternative.text : "") + '</div>'; }).join("")
              + '</details>');
          }
        }
      });
      var loopRefs = conversation && Array.isArray(conversation.loopRefs) ? conversation.loopRefs : [];
      loopRefs.forEach(function (fingerprint) {
        var shortFingerprint = String(fingerprint || "").slice(0, 12);
        if (!shortFingerprint) return;
        appendLine(log, '<div class="kp-ev kp-ev-done kp-loop-card" data-loop-fp="' + escAttr(shortFingerprint) + '"><span class="kp-loop-copy">已入队自建循环</span><code class="kp-loop-fp">' + esc(shortFingerprint) + '</code><button class="kp-loop-backlog" type="button" data-loop-backlog>查看 backlog</button></div>');
      });
      kpHydrateCompletedMessages(log);
      updateTokens(log, win.querySelector(".kp-win-toks"));
      if (latestUsage) kpUpdateContextMeter(win, latestUsage);
      else kpHideContextMeter(win);
    }
    function reloadConversationWindow(win) {
      var id = win && win.getAttribute ? win.getAttribute("data-conv") || "" : "";
      if (!id) return Promise.resolve();
      return fetch("/api/conversations/" + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (conversation) {
        if (conversation && conversation.id) {
          syncWindowTitle(win, "chat", conversation.title);
          renderConversationTurns(win, conversation);
          applyConversationSensitive(win, conversation.sensitive === true);
        }
      }).catch(function () {});
    }
    function refreshConversations() {
      if (!convList) return Promise.resolve();
      var requestId = ++conversationListRequest;
      var endpoint = conversationArchiveView ? "/api/conversations?archived=true" : "/api/conversations";
      return fetch(endpoint).then(function (r) { return r.json(); }).then(function (items) {
        if (requestId !== conversationListRequest) return;
        var rows = Array.isArray(items) ? items : [];
        if (conversationArchiveView) rows = rows.filter(function (c) { return c && c.archived === true; });
        if (!conversationArchiveView) {
          rows.sort(function (a, b) {
            return Number(b && b.pinned === true) - Number(a && a.pinned === true)
              || Number(b && b.updatedAt || 0) - Number(a && a.updatedAt || 0)
              || String(a && a.id || "").localeCompare(String(b && b.id || ""));
          });
        }
        if (!rows.length) {
          convList.innerHTML = '<div class="kp-conv-empty">' + (conversationArchiveView ? '暂无归档会话' : '暂无历史会话') + '</div>';
          return;
        }
        var last = "";
        convList.innerHTML = rows.map(function (c) {
          var group = !conversationArchiveView && c.pinned === true ? "置顶" : convGroupLabel(c.updatedAt);
          var head = group !== last ? '<div class="kp-conv-group">' + group + '</div>' : "";
          last = group;
          if (conversationArchiveView) {
            return head
              + '<div class="kp-conv-item" data-conv="' + escAttr(c.id) + '" title="' + escAttr(c.title || "新对话") + '">'
              + '<div class="ct">' + (c.sensitive === true ? '🔒 ' : '') + esc(c.title || "新对话") + (typeof c.ttlDays === "number" ? ' <span class="kp-localfs-chip">⏳' + esc(String(c.ttlDays)) + '天</span>' : '') + '</div>'
              + '<div class="cm">' + esc(convTime(c.updatedAt)) + ' · ' + esc(String(c.messageCount || 0)) + ' 条</div>'
              + '<div class="acts">'
              + '<button class="b gh" data-conv-restore type="button">恢复</button>'
              + '<button class="b dn" data-conv-purge data-armed="0" type="button">彻底删除</button>'
              + '</div></div>';
          }
          return head
            + '<div class="kp-conv-item" data-conv="' + escAttr(c.id) + '" data-pinned="' + (c.pinned === true ? 'true' : 'false') + '" title="' + escAttr(c.title || "新对话") + '">'
            + '<div class="ct">' + (c.sensitive === true ? '🔒 ' : '') + esc(c.title || "新对话") + (typeof c.ttlDays === "number" ? ' <span class="kp-localfs-chip">⏳' + esc(String(c.ttlDays)) + '天</span>' : '') + '</div>'
            + '<div class="cm">' + esc(convTime(c.updatedAt)) + ' · ' + esc(String(c.messageCount || 0)) + ' 条</div>'
            + '<button class="kp-conv-exp kp-conv-pin kp-mobile-touch-target" data-conv-pin type="button" aria-pressed="' + (c.pinned === true ? 'true' : 'false') + '" title="' + (c.pinned === true ? '取消置顶' : '置顶') + '" aria-label="' + (c.pinned === true ? '取消置顶' : '置顶') + '">📌</button>'
            + '<button class="kp-conv-exp" title="导出为 Markdown" aria-label="导出">\\u2B07</button>'
            + '<button class="kp-conv-exp kp-conv-fork" data-conv-fork title="分叉会话" aria-label="分叉">分叉</button>'
            + '<button class="kp-conv-del" title="删除" aria-label="删除">\\u2715</button>'
            + '</div>';
        }).join("");
      }).catch(function () {
        if (requestId !== conversationListRequest) return;
        convList.innerHTML = '<div class="kp-conv-empty">会话列表加载失败</div>';
      });
    }
    function searchConversations(q) {
      if (!convList) return;
      if (conversationArchiveView) { refreshConversations(); return; }
      if (q.trim().length < 2) { refreshConversations(); return; }
      var requestId = ++conversationListRequest;
      fetch("/api/conversations/search?q=" + encodeURIComponent(q)).then(function (r) {
        if (r.status === 404) return fetch("/api/conversations?q=" + encodeURIComponent(q));
        return r;
      }).then(function (r) {
        if (!r.ok) throw new Error("conversation search failed");
        return r.json();
      }).then(function (items) {
        if (requestId !== conversationListRequest) return;
        var rows = Array.isArray(items) ? items : [];
        if (!rows.length) { convList.innerHTML = '<div class="kp-conv-empty">没有匹配的会话</div>'; return; }
        convList.innerHTML = rows.map(function (c) {
          return '<div class="kp-conv-item" data-conv="' + escAttr(c.id) + '" data-pinned="' + (c.pinned === true ? 'true' : 'false') + '" title="' + escAttr(c.title || "新对话") + '">'
            + '<div class="ct">' + (c.sensitive === true ? '🔒 ' : '') + esc(c.title || "新对话") + (c.archived === true ? ' <span class="tag">归档</span>' : '') + '</div>'
            + (c.snippet ? '<div class="kp-conv-snip">' + esc(c.snippet) + '</div>' : '')
            + '<div class="cm">' + esc(convTime(c.updatedAt)) + '</div>'
            + '<button class="kp-conv-exp kp-conv-pin kp-mobile-touch-target" data-conv-pin type="button" aria-pressed="' + (c.pinned === true ? 'true' : 'false') + '" title="' + (c.pinned === true ? '取消置顶' : '置顶') + '" aria-label="' + (c.pinned === true ? '取消置顶' : '置顶') + '">📌</button>'
            + '</div>';
        }).join("");
      }).catch(function () {
        if (requestId !== conversationListRequest) return;
        convList.innerHTML = '<div class="kp-conv-empty">会话搜索失败</div>';
      });
    }
    function kpIsRemoteHost() {
      return location.hostname !== "localhost" && location.hostname !== "127.0.0.1";
    }
    function applyConversationSensitive(win, sensitive) {
      if (!win) return;
      var active = sensitive === true;
      win.setAttribute("data-sensitive", active ? "true" : "false");
      var chip = win.querySelector(".kp-sensitive-chip");
      if (chip) {
        chip.classList.toggle("on", active);
        chip.setAttribute("aria-pressed", active ? "true" : "false");
        chip.textContent = active ? "🔒 敏感·不进知识库" : "🔓";
        chip.title = active
          ? "已锁定:本会话所有内容全程不进知识库、不沉淀;分叉会话继承;点击解锁"
          : "点击锁定:从现在起本会话内容将一直不进知识库、不被沉淀,直到手动解锁;分叉会话继承";
      }
    }
    function openConversation(id, knownTitle) {
      if (!id) return;
      var wins = winHost.querySelectorAll(".kp-win[data-conv]");
      for (var i = 0; i < wins.length; i++) {
        if (wins[i].getAttribute("data-conv") === id) {
          if (knownTitle) syncWindowTitle(wins[i], "chat", knownTitle);
          if (wins[i].scrollIntoView) wins[i].scrollIntoView({ block: "nearest" });
          return;
        }
      }
      if (openingConvs[id]) return;
      openingConvs[id]=1;
      fetch("/api/conversations/" + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (conversation) {
        if (!conversation || !conversation.id) { delete openingConvs[id]; return; }
        var win = addWindow("chat", conversation);
        if (!win || win.getAttribute("data-conv") !== String(conversation.id)) { delete openingConvs[id]; return; }
        renderConversationTurns(win, conversation);
        delete openingConvs[id];
      }).catch(function () { delete openingConvs[id]; });
    }

    function kpApplyConvModel(sel, model) {
      sel.value = model;
      if (sel.selectedIndex < 0) sel.value = "claude-opus-5";
    }
    function modelSelectHtml() {
      return '<label class="kp-lbl">模型</label>'
        + '<select class="kp-model kp-win-model" title="切换对话模型">'
        + '<option value="claude-opus-5">Opus 5</option>'
        + '<option value="claude-opus-5-5">Opus 5.5</option>'
        + '<option value="claude-sonnet-5">Sonnet 5</option>'
        + '<option value="claude-sonnet-5-5">Sonnet 5.5</option>'
        + '<option value="claude-haiku-5-5">Haiku 5.5</option>'
        + '<option value="codex">Codex 5.5</option>'
        + '<option value="gpt-6-astra">GPT-6 Astra</option>'
        + '<option value="gpt-6-sol">GPT-6 Sol</option>'
        + '<option value="gpt-6-luna">GPT-6 Luna</option>'
        + '<option value="gpt-5.6-sol">GPT-5.6 Sol</option>'
        + '<option value="gpt-5.6-terra">GPT-5.6 Terra</option>'
        + '<option value="gpt-5.6-luna">GPT-5.6 Luna</option>'
        + '<option value="claude-fable-5">Fable 5</option>'
        + '<option value="claude-fable-5-1">Fable 5.1</option></select>';
    }
    function winHtml(id, kind, conversation) {
      var isChat = kind === "chat";
      var fullTitle = windowTitleValue(kind, conversation && conversation.title);
      var displayTitle = shortWindowTitle(fullTitle);
      var empty = isChat
        ? chatEmptyStateHtml()
        : '<div class="kp-stream-empty">▸ <b>下一个开发任务</b>,回车发送。我驱动鲲鹏 loop 真干活:spec → 实现 → 验证 → 合并门。</div>';
      return '<div class="kp-win" data-win="' + id + '" data-kind="' + kind + '">'
        + '<div class="kp-term-bar">'
        + '<div class="kp-term-dots"><i></i><i></i><i></i></div>'
        + '<div class="kp-term-title" title="' + escAttr(fullTitle) + '"><span class="kp-term-avatar">鹏</span><span class="kp-term-title-text">' + esc(displayTitle) + '</span></div>'
        + modelSelectHtml()
        + (isChat ? '<label class="kp-lbl">⏳ 保留期</label><select class="kp-model kp-ttl-select" title="到期自动归档(不删除,可在归档中找回)"><option value="">永久</option><option value="7">7天</option><option value="30">30天</option><option value="90">90天</option></select>' : '')
        + (isChat ? '<button type="button" class="kp-localfs-chip kp-sensitive-chip" aria-pressed="false" title="点击锁定:从现在起本会话内容将一直不进知识库、不被沉淀,直到手动解锁;分叉会话继承">🔓</button>' : '')
        + (isChat ? '<span class="kp-help kp-sensitive-help" tabindex="0" role="button" aria-label="什么是敏感·不进知识库"><span class="kp-help-q">?</span><span class="kp-help-pop"><b>「敏感 · 不进知识库」是什么?</b><br>开启后,本会话的全部内容<b>全程不进知识库</b>、不被沉淀检索;由它<b>分叉出的子会话也会继承</b>这个锁。异地机器(非本机)访问时<b>默认开启</b>。点击左侧胶囊可随时锁定 / 解锁。</span></span>' : '')
        + (isChat ? '<button class="kp-localfs-chip kp-localfs-access" title="授权一个本地目录，让对话里的 agent 读写其中文件">\\uD83D\\uDCC1 \\u6388\\u6743\\u672C\\u5730\\u76EE\\u5F55</button>' : '')
        + (isChat ? '<div class="kp-projection-switch" role="group" aria-label="过程投影"><button type="button" data-projection="detail">详细</button><button type="button" data-projection="normal">普通</button><button type="button" data-projection="result">结果</button></div>' : '')
        + '<label class="kp-lbl" style="margin-left:auto">用量</label>'
        + '<span class="kp-toks kp-win-toks" title="本会话累计 token(输入+输出)">0 tokens</span>'
        + '<div class="kp-term-status"><span class="dot"></span><span class="kp-win-state">就绪</span></div>'
        + '<button class="kp-win-close" title="关闭窗口">\\u2715</button>'
        + '</div>'
        + (isChat ? '<div class="kp-win-search" role="search" aria-label="窗口内查找" hidden>'
          + '<input class="kp-win-search-input" type="search" autocomplete="off" placeholder="查找当前窗口消息" aria-label="查找当前窗口消息">'
          + '<span class="kp-win-search-count" aria-live="polite">0/0</span>'
          + '<button type="button" data-kp-search-prev title="上一个匹配" aria-label="上一个匹配">\\u2191</button>'
          + '<button type="button" data-kp-search-next title="下一个匹配" aria-label="下一个匹配">\\u2193</button>'
          + '<button type="button" data-kp-search-close title="关闭查找" aria-label="关闭查找">\\u2715</button>'
          + '</div>' : '')
        + '<div class="kp-stream kp-win-log">' + empty + '</div>'
        + '<button class="kp-jump" type="button" title="跳到最新" style="display:none">\\u2193 \\u6700\\u65B0</button>'
        + '<div class="kp-composer">'
        + (isChat ? '<div class="kp-cmdmenu" style="display:none"></div>' : '')
        + (isChat ? '<button type="button" class="kp-localfs-chip kp-queue-chip" style="display:none"></button><div class="kp-chips kp-queue-list" style="display:none"></div>' : '')
        + (isChat ? '<div class="kp-chips kp-attachment-chips" style="display:none"></div>' : '')
        + (isChat ? '<div class="kp-ctx-meter tb-bar seg" hidden><i class="kp-ctx-meter-fill seg-bar"></i></div>' : '')
        + (isChat ? '<div class="kp-quick-bar" role="group" aria-label="快捷入口">'
          + '<button type="button" class="kp-example" data-kp-quick-authorize="1">📁 授权本地目录</button>'
          + '<button type="button" class="kp-example" data-kp-needs-dir="1" data-kp-example="读取已授权目录「{dir}」，梳理其中内容并生成一份可阅读的 HTML 汇报，写回该目录。">📊 读文件夹 → HTML 汇报</button>'
          + '<button type="button" class="kp-example" data-kp-needs-dir="1" data-kp-example="根据已授权目录「{dir}」里的材料生成一份文档（Word / PPT / Excel 任选一种），中文排版，写回该目录，交付前自检文件能正常打开且内容非空。">📄 生成 Word / PPT / Excel</button>'
          + '<button type="button" class="kp-example" data-kp-example="帮我研究下面这个主题，查证后给出带来源出处的结论：">🔎 抓网页 / 做资料研究</button>'
          + '<button type="button" class="kp-example" data-kp-example="/loop ">🔁 /loop 起开发循环</button>'
          + '<button type="button" class="kp-example" data-kp-example="/skills">🧩 /skills 看能力</button>'
          + '</div>' : '')
        + '<div class="kp-cbox">' + (isChat ? '<button type="button" class="b gh kp-chat-mode" aria-pressed="false" title="Plan/Act 会话档位">Act</button>' : '') + '<span class="pmt">&gt;</span>'
        + '<textarea class="kp-win-input" rows="1" placeholder="' + (isChat ? '对话/命令，可粘贴或拖入附件 — 回车发送' : '输入开发任务 — 回车发送') + '"></textarea>'
        + '<button class="kp-send kp-win-send">\\u25B6 \\u53D1\\u9001</button></div></div>'
        + '</div>';
    }

    function fmtTokens(logEl) {
      var total = 0;
      logEl.querySelectorAll(".kp-ev-usage").forEach(function (u) {
        var m = u.textContent.match(/in\\s+(\\d+)\\s*\\/\\s*out\\s+(\\d+)/);
        if (m) total += (parseInt(m[1], 10) || 0) + (parseInt(m[2], 10) || 0);
      });
      return total;
    }

    function wireWindow(win) {
      var id = win.getAttribute("data-win");
      var kind = win.getAttribute("data-kind");
      function activateWindow() {
        try {
          var prev = document.querySelectorAll(".kp-win-active");
          for (var i = 0; i < prev.length; i++) prev[i].classList.remove("kp-win-active");
          win.classList.add("kp-win-active");
        } catch (_e) {}
      }
      function deactivateWindowWhenOutside(event) {
        try {
          if (!win.contains(event.target)) win.classList.remove("kp-win-active");
        } catch (_e) {}
      }
      win.addEventListener("focusin", activateWindow);
      win.addEventListener("pointerdown", activateWindow);
      document.addEventListener("focusin", deactivateWindowWhenOutside);
      document.addEventListener("pointerdown", deactivateWindowWhenOutside);
      var input = win.querySelector(".kp-win-input");
      var log = win.querySelector(".kp-win-log");
      var jump = win.querySelector(".kp-jump");
      if (jump && log) {
        log.addEventListener("scroll", function () { jump.style.display = nearBottom(log) ? "none" : "block"; });
        jump.addEventListener("click", function () { log.scrollTop = log.scrollHeight; jump.style.display = "none"; });
      }
      var toks = win.querySelector(".kp-win-toks");
      var modelEl = win.querySelector(".kp-win-model");
      var stateEl = win.querySelector(".kp-win-state");
      var cur = null, curFin = null;
      var sendBtn = win.querySelector(".kp-win-send");
      var editingLast = false;
      var chatModeButton = win.querySelector(".kp-chat-mode");
      var sensitiveChip = win.querySelector(".kp-sensitive-chip");
      var ttlSelect = win.querySelector(".kp-ttl-select");
      var projectionButtons = win.querySelectorAll("[data-projection]");
      var chatProjection = "normal";
      var chatMode = "act";
      var normalChatPlaceholder = "对话/命令，可粘贴或拖入附件 — 回车发送";
      var planChatPlaceholder = "Plan:只讨论方案(/code 临时执行)";
      var draftTimer = null;
      var draftDirty = false;
      var activeDraftKey = "kpDraft:" + (win.getAttribute("data-conv") || "win:" + id);
      var disposeWindowSearch = function () {};
      function setupWindowSearch() {
        if (kind !== "chat" || !log) return function () {};
        try {
          var searchBar = win.querySelector(".kp-win-search");
          var searchInput = win.querySelector(".kp-win-search-input");
          var searchCount = win.querySelector(".kp-win-search-count");
          var previousButton = win.querySelector("[data-kp-search-prev]");
          var nextButton = win.querySelector("[data-kp-search-next]");
          var closeButton = win.querySelector("[data-kp-search-close]");
          if (!searchBar || !searchInput || !searchCount || !previousButton || !nextButton || !closeButton) return function () {};
          var searchHits = [];
          var searchCurrent = -1;
          var focusBeforeSearch = null;
          function clearSearchMarks() {
            try {
              var marked = log.querySelectorAll(".kp-search-hit,.kp-search-current");
              for (var i = 0; i < marked.length; i++) marked[i].classList.remove("kp-search-hit", "kp-search-current");
            } catch (_e) {}
          }
          function updateSearchCount() {
            searchCount.textContent = searchHits.length && searchCurrent >= 0
              ? (searchCurrent + 1) + "/" + searchHits.length
              : "0/0";
          }
          function messageText(block) {
            var copy = block.getAttribute ? block.getAttribute("data-copy") : null;
            return String(copy === null ? block.textContent || "" : copy).toLocaleLowerCase();
          }
          function showSearchCurrent(index) {
            if (!searchHits.length) {
              searchCurrent = -1;
              updateSearchCount();
              return;
            }
            searchCurrent = ((index % searchHits.length) + searchHits.length) % searchHits.length;
            for (var i = 0; i < searchHits.length; i++) searchHits[i].classList.toggle("kp-search-current", i === searchCurrent);
            updateSearchCount();
            var current = searchHits[searchCurrent];
            try { if (current && current.scrollIntoView) current.scrollIntoView({ block: "nearest" }); } catch (_e) {}
          }
          function applyWindowSearch(preferredIndex) {
            try {
              clearSearchMarks();
              searchHits = [];
              searchCurrent = -1;
              var query = String(searchInput.value || "").trim().toLocaleLowerCase();
              if (query) {
                var blocks = log.querySelectorAll(".kp-chat-me,.kp-msg");
                for (var i = 0; i < blocks.length; i++) {
                  if (messageText(blocks[i]).indexOf(query) < 0) continue;
                  blocks[i].classList.add("kp-search-hit");
                  searchHits.push(blocks[i]);
                }
              }
              showSearchCurrent(typeof preferredIndex === "number" ? preferredIndex : 0);
            } catch (_e) {
              searchHits = [];
              searchCurrent = -1;
              clearSearchMarks();
              try { updateSearchCount(); } catch (_ignored) {}
            }
          }
          function moveWindowSearch(delta) {
            var target = searchHits.length ? searchCurrent + delta : (delta < 0 ? -1 : 0);
            applyWindowSearch(target);
          }
          function openWindowSearch() {
            try {
              if (searchBar.hidden) focusBeforeSearch = document.activeElement;
              searchBar.hidden = false;
              applyWindowSearch(searchCurrent < 0 ? 0 : searchCurrent);
              searchInput.focus();
              if (searchInput.select) searchInput.select();
            } catch (_e) {}
          }
          function closeWindowSearch() {
            try {
              clearSearchMarks();
              searchHits = [];
              searchCurrent = -1;
              searchInput.value = "";
              updateSearchCount();
              searchBar.hidden = true;
              if (focusBeforeSearch && win.contains(focusBeforeSearch) && focusBeforeSearch.focus) focusBeforeSearch.focus();
              focusBeforeSearch = null;
            } catch (_e) {}
          }
          function onWindowSearchKeydown(event) {
            try {
              var activeWindow = document.querySelector(".kp-win-active");
              if (activeWindow !== win) return;
              var key = String(event.key || "");
              if ((event.metaKey || event.ctrlKey) && key.toLocaleLowerCase() === "f") {
                event.preventDefault();
                event.stopPropagation();
                openWindowSearch();
                return;
              }
              if (searchBar.hidden) return;
              if (key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeWindowSearch();
                return;
              }
              if (key === "Enter" && searchBar.contains(event.target)) {
                event.preventDefault();
                moveWindowSearch(event.shiftKey ? -1 : 1);
              }
            } catch (_e) {}
          }
          function onSearchInput() { applyWindowSearch(0); }
          function onPreviousSearch() { moveWindowSearch(-1); }
          function onNextSearch() { moveWindowSearch(1); }
          searchInput.addEventListener("input", onSearchInput);
          previousButton.addEventListener("click", onPreviousSearch);
          nextButton.addEventListener("click", onNextSearch);
          closeButton.addEventListener("click", closeWindowSearch);
          document.addEventListener("keydown", onWindowSearchKeydown);
          return function () {
            try {
              document.removeEventListener("keydown", onWindowSearchKeydown);
              clearSearchMarks();
            } catch (_e) {}
          };
        } catch (_e) {
          return function () {};
        }
      }
      disposeWindowSearch = setupWindowSearch();
      function draftStorageKey() { return "kpDraft:" + (win.getAttribute("data-conv") || "win:" + id); }
      function resizeInput() {
        if (!input) return;
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 160) + "px";
      }
      function writeDraft(value, key) {
        if (kind !== "chat") return;
        try {
          var draftValue = String(value || "");
          if (draftValue.trim()) localStorage.setItem(key || activeDraftKey, draftValue);
          else localStorage.removeItem(key || activeDraftKey);
        } catch (_e) {}
      }
      function persistDraft() {
        if (!input) return;
        writeDraft(input.value, activeDraftKey);
        draftDirty = false;
      }
      function scheduleDraft() {
        if (kind !== "chat") return;
        draftDirty = true;
        if (draftTimer) clearTimeout(draftTimer);
        draftTimer = setTimeout(function () { draftTimer = null; persistDraft(); }, 400);
      }
      function saveDraftSnapshot(value) {
        if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
        writeDraft(value, activeDraftKey);
        draftDirty = false;
      }
      function restoreDraft() {
        if (kind !== "chat" || !input || input.value) return;
        try {
          var saved = localStorage.getItem(activeDraftKey);
          if (saved) { input.value = saved; resizeInput(); draftDirty = false; }
        } catch (_e) {}
      }
      function syncDraftConversation() {
        var previousKey = activeDraftKey;
        activeDraftKey = draftStorageKey();
        if (input && input.value) {
          writeDraft(input.value, activeDraftKey);
          draftDirty = false;
          if (previousKey !== activeDraftKey) {
            try { if (localStorage.getItem(previousKey) === input.value) localStorage.removeItem(previousKey); } catch (_e) {}
          }
        } else restoreDraft();
      }
      function clearCompletedDraft(runInfo) {
        if (!runInfo || !runInfo.draftKey) return;
        try {
          if (localStorage.getItem(runInfo.draftKey) === String(runInfo.draftValue || "")) localStorage.removeItem(runInfo.draftKey);
        } catch (_e) {}
      }
      function persistDraftOnExit() {
        if (input && (draftDirty || input.value)) persistDraft();
      }
      function appendSensitiveEvent(sensitive) {
        appendLine(log, '<div class="kp-ev">' + (sensitive
          ? '🔒 已锁定敏感会话:从现在起本会话内容一直不进知识库、不被沉淀,直到手动解锁;分叉的会话继承此锁'
          : '🔓 已解锁:此后新内容恢复可进知识库(此前不追溯)') + '</div>');
      }
      if (sensitiveChip) sensitiveChip.addEventListener("click", function () {
        var nextSensitive = win.getAttribute("data-sensitive") !== "true";
        var convId = win.getAttribute("data-conv") || "";
        if (!convId) {
          applyConversationSensitive(win, nextSensitive);
          appendSensitiveEvent(nextSensitive);
          return;
        }
        sensitiveChip.disabled = true;
        fetch("/api/conversations/" + encodeURIComponent(convId), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sensitive: nextSensitive })
        }).then(function (r) {
          if (!r.ok) throw new Error("sensitive PATCH failed");
          return r.json();
        }).then(function (conversation) {
          var savedSensitive = conversation && conversation.sensitive === true;
          applyConversationSensitive(win, savedSensitive);
          appendSensitiveEvent(savedSensitive);
          return refreshConversations();
        }).catch(function () {}).then(function () { sensitiveChip.disabled = false; });
      });
      var sensitiveHelp = win.querySelector(".kp-sensitive-help");
      if (sensitiveHelp) {
        var toggleHelp = function (e) {
          e.preventDefault();
          e.stopPropagation();
          var opening = !sensitiveHelp.classList.contains("on");
          var otherOpen = document.querySelectorAll(".kp-help.on");
          for (var oi = 0; oi < otherOpen.length; oi++) otherOpen[oi].classList.remove("on");
          sensitiveHelp.classList.toggle("on", opening);
        };
        sensitiveHelp.addEventListener("click", toggleHelp);
        sensitiveHelp.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") toggleHelp(e);
          else if (e.key === "Escape") sensitiveHelp.classList.remove("on");
        });
        document.addEventListener("click", function (e) {
          if (sensitiveHelp.classList.contains("on") && !sensitiveHelp.contains(e.target)) sensitiveHelp.classList.remove("on");
        });
      }
      if (ttlSelect) ttlSelect.addEventListener("change", function () {
        var convId = win.getAttribute("data-conv") || "";
        if (!convId) {
          ttlSelect.value = "";
          appendLine(log, '<div class="kp-ev kp-ev-error">请先发送一条消息,再设置保留期</div>');
          return;
        }
        var previous = win.getAttribute("data-ttl-days") || "";
        var selected = ttlSelect.value;
        ttlSelect.disabled = true;
        fetch("/api/conversations/" + encodeURIComponent(convId), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ttlDays: selected === "" ? null : Number(selected) })
        }).then(function (r) {
          if (!r.ok) throw new Error("ttlDays PATCH failed");
          return r.json();
        }).then(function (conversation) {
          var saved = conversation && typeof conversation.ttlDays === "number" ? String(conversation.ttlDays) : "";
          win.setAttribute("data-ttl-days", saved);
          ttlSelect.value = saved;
          appendLine(log, '<div class="kp-ev kp-ev-done">保留期已设为' + (saved ? saved + '天' : '永久') + ':到期自动归档(不删除,可在归档中找回)</div>');
          return refreshConversations();
        }).catch(function () {
          ttlSelect.value = previous;
          appendLine(log, '<div class="kp-ev kp-ev-error">保留期设置失败</div>');
        }).then(function () { ttlSelect.disabled = false; });
      });
      function chatModeStorageKey() { return "kpChatMode:" + (win.getAttribute("data-conv") || id); }
      function readChatMode() {
        try { return localStorage.getItem(chatModeStorageKey()) === "plan" ? "plan" : "act"; } catch (_e) { return "act"; }
      }
      function applyChatMode(mode, persist) {
        chatMode = mode === "plan" ? "plan" : "act";
        if (chatModeButton) {
          chatModeButton.textContent = chatMode === "plan" ? "Plan" : "Act";
          chatModeButton.classList.toggle("on", chatMode === "plan");
          chatModeButton.setAttribute("aria-pressed", chatMode === "plan" ? "true" : "false");
        }
        if (input && kind === "chat") input.setAttribute("placeholder", chatMode === "plan" ? planChatPlaceholder : normalChatPlaceholder);
        if (persist) { try { localStorage.setItem(chatModeStorageKey(), chatMode); } catch (_e) {} }
      }
      function projectionStorageKey() { return "kp-chat-projection"; }
      function readChatProjection() {
        try {
          var stored = localStorage.getItem(projectionStorageKey());
          return stored === "detail" || stored === "normal" || stored === "result" ? stored : "normal";
        } catch (_e) { return "normal"; }
      }
      function isProcessFrame(node) {
        if (!node || node.nodeType !== 1 || !node.matches) return false;
        if (node.matches(".kp-msg,.kp-ev-token,.kp-ev-usage,.kp-ev-error,.kp-chat-me,[data-loop-fp]")) return false;
        return node.matches(".kp-ev,.kp-ev-think,.kp-localfs-ev");
      }
      function restoreProcessFrames() {
        if (!log) return;
        log.querySelectorAll(".kp-projection-hidden").forEach(function (node) { node.classList.remove("kp-projection-hidden"); });
        log.querySelectorAll(".kp-process-group").forEach(function (group) {
          var body = group.querySelector(".kp-process-items");
          if (body) while (body.firstChild) group.parentNode.insertBefore(body.firstChild, group);
          group.remove();
        });
      }
      function groupProcessFrames() {
        if (!log) return;
        var node = log.firstElementChild;
        while (node) {
          if (!isProcessFrame(node)) { node = node.nextElementSibling; continue; }
          var group = document.createElement("details");
          group.className = "kp-process-group";
          group.innerHTML = '<summary>⚙ 过程 <span class="kp-process-count">0</span> 步</summary><div class="kp-process-items"></div>';
          log.insertBefore(group, node);
          var body = group.querySelector(".kp-process-items");
          var count = 0;
          while (node && isProcessFrame(node)) {
            var next = node.nextElementSibling;
            body.appendChild(node);
            count += 1;
            node = next;
          }
          group.querySelector(".kp-process-count").textContent = String(count);
        }
      }
      function applyChatProjection(mode, persist) {
        chatProjection = mode === "detail" || mode === "result" ? mode : "normal";
        restoreProcessFrames();
        if (chatProjection === "normal") groupProcessFrames();
        if (chatProjection === "result" && log) {
          Array.prototype.forEach.call(log.children, function (node) {
            if (isProcessFrame(node)) node.classList.add("kp-projection-hidden");
          });
        }
        win.setAttribute("data-projection-mode", chatProjection);
        Array.prototype.forEach.call(projectionButtons, function (button) {
          var active = button.getAttribute("data-projection") === chatProjection;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
        if (persist) { try { localStorage.setItem(projectionStorageKey(), chatProjection); } catch (_e) {} }
      }
      if (kind === "chat") {
        restoreDraft();
        window.addEventListener("beforeunload", persistDraftOnExit);
        applyChatMode(readChatMode(), false);
        if (chatModeButton) chatModeButton.addEventListener("click", function () { applyChatMode(chatMode === "plan" ? "act" : "plan", true); });
        win.addEventListener("kp:conversation-changed", function () { kpResetContextMeter(win); applyChatMode(chatMode, true); syncDraftConversation(); });
        applyChatProjection(readChatProjection(), false);
        Array.prototype.forEach.call(projectionButtons, function (button) {
          button.addEventListener("click", function () { applyChatProjection(button.getAttribute("data-projection"), true); });
        });
        win.addEventListener("kp:chat-projection-change", function () { applyChatProjection(chatProjection, false); });
      }
      var messageQueue = kind === "chat" ? [] : null;
      var queueChip = win.querySelector(".kp-queue-chip");
      var queueList = win.querySelector(".kp-queue-list");
      var queueExpanded = false;
      var chips = win.querySelector(".kp-attachment-chips");
      var pendingImgs = []; // { id, url, name }
      var webOn = false;
      var cmdMenu = win.querySelector(".kp-cmdmenu");
      var cmdSel = 0, cmdList = [];
      var COMMANDS = CHAT_COMMANDS;
      function hideMenu() { if (cmdMenu) { cmdMenu.style.display = "none"; } cmdList = []; }
      function renderMenu() {
        var v = input.value;
        var prefix = /^\\/(\\w*)$/.exec(v);
        if (kind !== "chat" || !cmdMenu || !prefix) { hideMenu(); return; }
        var q = prefix[1].toLowerCase();
        cmdList = COMMANDS.filter(function (c) { return c.name.toLowerCase().indexOf(q) === 0; });
        if (!cmdList.length) { hideMenu(); return; }
        if (cmdSel >= cmdList.length) cmdSel = 0;
        cmdMenu.innerHTML = cmdList.map(function (c, i) {
          return '<div class="kp-cmdrow' + (i === cmdSel ? " sel" : "") + '" data-kp-cmd data-i="' + i + '"><span class="cn">' + esc(c.usage) + '</span><span class="cd">' + esc(c.description) + '</span></div>';
        }).join("");
        cmdMenu.style.display = "block";
      }
      function pickCmd(i) {
        var c = cmdList[i]; if (!c) return;
        input.value = "/" + c.name + (c.usage.indexOf(" ") >= 0 ? " " : "");
        resizeInput(); scheduleDraft(); hideMenu(); input.focus();
      }
      if (cmdMenu) cmdMenu.addEventListener("click", function (e) {
        var r = e.target && e.target.closest ? e.target.closest("[data-i]") : null;
        if (r) pickCmd(parseInt(r.getAttribute("data-i"), 10));
      });
      function renderQueue() {
        if (!messageQueue || !queueChip || !queueList) return;
        queueChip.textContent = "排队 " + messageQueue.length + " 条";
        queueChip.style.display = messageQueue.length ? "inline-flex" : "none";
        queueList.innerHTML = messageQueue.map(function (message, i) {
          return '<button type="button" class="kp-localfs-chip" data-q-rm="' + i + '">' + esc(message) + ' <span class="x">\\u2715</span></button>';
        }).join("");
        queueList.style.display = queueExpanded && messageQueue.length ? "flex" : "none";
      }
      function clearQueue() {
        if (!messageQueue) return;
        messageQueue.length = 0;
        queueExpanded = false;
        renderQueue();
      }
      function enqueueCurrentMessage() {
        var text = input && input.value ? String(input.value).trim() : "";
        if (!messageQueue || !cur || !text) return false;
        messageQueue.push(text);
        input.value = "";
        input.style.height = "";
        hideMenu();
        renderQueue();
        return true;
      }
      if (queueChip) queueChip.addEventListener("click", function () {
        queueExpanded = !queueExpanded;
        renderQueue();
      });
      if (queueList) queueList.addEventListener("click", function (e) {
        var button = e.target && e.target.closest ? e.target.closest("[data-q-rm]") : null;
        if (!button || !messageQueue) return;
        messageQueue.splice(parseInt(button.getAttribute("data-q-rm"), 10), 1);
        renderQueue();
      });
      var recognition = null;
      var speechTimer = null;
      var micButton = null;
      var speechActive = false;
      function finishSpeechUi() {
        if (speechTimer) { clearTimeout(speechTimer); speechTimer = null; }
        if (micButton) {
          micButton.classList.remove("kp-mic-on");
          micButton.classList.remove("on");
          micButton.setAttribute("aria-pressed", "false");
        }
      }
      function stopSpeech() {
        var wasActive = speechActive;
        speechActive = false;
        if (wasActive && recognition) {
          try { recognition.stop(); } catch (_e) {}
        }
        finishSpeechUi();
      }
      function resetSpeechTimer() {
        if (speechTimer) clearTimeout(speechTimer);
        speechTimer = setTimeout(stopSpeech, 5000);
      }
      var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (kind === "chat" && input && sendBtn && SpeechRecognition) {
        try {
          recognition = new SpeechRecognition();
          recognition.lang = "zh-CN";
          recognition.interimResults = true;
          recognition.continuous = true;
          var speechPrefix = "";
          var speechSuffix = "";
          recognition.onresult = function (event) {
            var transcript = "";
            for (var i = 0; i < event.results.length; i++) {
              transcript += event.results[i][0] ? event.results[i][0].transcript : "";
            }
            input.value = speechPrefix + transcript + speechSuffix;
            var cursor = speechPrefix.length + transcript.length;
            input.setSelectionRange(cursor, cursor);
            input.style.height = "auto";
            input.style.height = Math.min(input.scrollHeight, 160) + "px";
            scheduleDraft();
            renderMenu();
            resetSpeechTimer();
          };
          recognition.onend = function () { speechActive = false; finishSpeechUi(); };
          recognition.onerror = function () { speechActive = false; finishSpeechUi(); };
          micButton = document.createElement("button");
          micButton.type = "button";
          micButton.className = "kp-localfs-chip kp-mic";
          micButton.textContent = "\\uD83C\\uDFA4";
          micButton.title = "中文语音输入";
          micButton.setAttribute("aria-label", "中文语音输入");
          micButton.setAttribute("aria-pressed", "false");
          sendBtn.parentNode.insertBefore(micButton, sendBtn);
          micButton.addEventListener("click", function () {
            if (micButton.classList.contains("kp-mic-on")) { stopSpeech(); return; }
            var start = typeof input.selectionStart === "number" ? input.selectionStart : input.value.length;
            var end = typeof input.selectionEnd === "number" ? input.selectionEnd : start;
            speechPrefix = input.value.slice(0, start);
            speechSuffix = input.value.slice(end);
            try {
              speechActive = true;
              micButton.classList.add("kp-mic-on");
              micButton.classList.add("on");
              micButton.setAttribute("aria-pressed", "true");
              recognition.start();
              resetSpeechTimer();
            } catch (_e) { stopSpeech(); }
          });
        } catch (_e) {
          recognition = null;
        }
      }
      function renderChips() {
        if (!chips) return;
        chips.innerHTML = pendingImgs.map(function (im, i) {
          var name = im.name || "文件";
          var label = name.length > 16 ? name.slice(0, 7) + "..." + name.slice(name.length - 6) : name;
          var body = im.url ? '<img src="' + im.url + '">' : '<span style="display:flex;width:100%;height:100%;box-sizing:border-box;padding:5px 4px;align-items:center;justify-content:center;text-align:center;font-size:9px;line-height:1.15;word-break:break-all;color:var(--ink)">\\uD83D\\uDCC4 ' + esc(label) + '</span>';
          return '<span class="kp-chip" title="' + escAttr(name) + '">' + body + '<button data-rm="' + i + '" title="移除">\\u2715</button></span>';
        }).join("");
        chips.style.display = pendingImgs.length ? "flex" : "none";
      }
      if (chips) chips.addEventListener("click", function (e) {
        var b = e.target && e.target.closest ? e.target.closest("[data-rm]") : null;
        if (!b) return;
        pendingImgs.splice(parseInt(b.getAttribute("data-rm"), 10), 1); renderChips();
      });
      function kpZipEntries(arrayBuffer) {
        var view = new DataView(arrayBuffer);
        var eocd = -1;
        var lowerBound = Math.max(0, view.byteLength - 65557);
        for (var i = view.byteLength - 22; i >= lowerBound; i--) {
          if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error("Office 文件不是有效 ZIP");
        var total = view.getUint16(eocd + 10, true);
        var cursor = view.getUint32(eocd + 16, true);
        var entries = [];
        var decoder = new TextDecoder("utf-8");
        for (var n = 0; n < total; n++) {
          if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Office ZIP 中央目录损坏");
          var method = view.getUint16(cursor + 10, true);
          var compSize = view.getUint32(cursor + 20, true);
          var nameLength = view.getUint16(cursor + 28, true);
          var extraLength = view.getUint16(cursor + 30, true);
          var commentLength = view.getUint16(cursor + 32, true);
          var offset = view.getUint32(cursor + 42, true);
          var next = cursor + 46 + nameLength + extraLength + commentLength;
          if (next > view.byteLength) throw new Error("Office ZIP 条目越界");
          var name = decoder.decode(new Uint8Array(arrayBuffer, cursor + 46, nameLength));
          entries.push({ name: name, method: method, compSize: compSize, offset: offset });
          cursor = next;
        }
        return entries;
      }
      async function kpZipRead(buf, entry, asArrayBuffer) {
        var view = new DataView(buf);
        var offset = entry.offset;
        if (offset + 30 > view.byteLength || view.getUint32(offset, true) !== 0x04034b50) throw new Error("Office ZIP 本地条目损坏:" + entry.name);
        var nameLength = view.getUint16(offset + 26, true);
        var extraLength = view.getUint16(offset + 28, true);
        var dataStart = offset + 30 + nameLength + extraLength;
        if (dataStart + entry.compSize > view.byteLength) throw new Error("Office ZIP 压缩数据越界:" + entry.name);
        var compressed = new Uint8Array(buf, dataStart, entry.compSize);
        var output;
        if (entry.method === 0) {
          output = compressed;
        } else if (entry.method === 8) {
          if (typeof DecompressionStream === "undefined") throw new Error("浏览器不支持本地解压,请升级浏览器");
          var stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
          output = new Uint8Array(await new Response(stream).arrayBuffer());
        } else {
          throw new Error("Office ZIP 不支持的压缩方式:" + entry.method);
        }
        if (asArrayBuffer) return output.slice().buffer;
        return new TextDecoder("utf-8").decode(output);
      }
      function kpDecodeXmlEntity(entity) {
        var named = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
        if (Object.prototype.hasOwnProperty.call(named, entity)) return named[entity];
        var hex = /^&#x([0-9a-f]+);$/i.exec(entity);
        var decimal = /^&#([0-9]+);$/.exec(entity);
        var codePoint = hex ? parseInt(hex[1], 16) : decimal ? parseInt(decimal[1], 10) : NaN;
        if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return entity;
        return String.fromCodePoint(codePoint);
      }
      function kpXmlText(xml) {
        return String(xml || "")
          .replace(/<[^>]*>/g, "")
          .replace(/&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-f]+);/gi, kpDecodeXmlEntity)
          .replace(/\\r\\n?/g, "\\n")
          .split("\\n")
          .map(function (line) { return line.replace(/[^\\S\\r\\n]+/g, " ").trim(); })
          .join("\\n")
          .trim();
      }
      function kpNumberedOfficeEntries(entries, prefix) {
        var found = [];
        entries.forEach(function (entry) {
          var lower = entry.name.toLowerCase();
          if (lower.indexOf(prefix) !== 0 || lower.slice(-4) !== ".xml") return;
          var rawNumber = lower.slice(prefix.length, -4);
          if (!/^[0-9]+$/.test(rawNumber)) return;
          found.push({ number: parseInt(rawNumber, 10), entry: entry });
        });
        return found.sort(function (a, b) { return a.number - b.number; });
      }
      function kpSharedStrings(xml) {
        var values = [];
        var pattern = /<si\\b[^>]*>([\\s\\S]*?)<\\/si>/gi;
        var match;
        while ((match = pattern.exec(xml)) !== null) values.push(kpXmlText(match[1]));
        return values;
      }
      function kpCellValue(attributes, body, sharedStrings) {
        var typeMatch = /\\bt\\s*=\\s*["']([^"']+)["']/i.exec(attributes);
        var inline = /<is\\b[^>]*>([\\s\\S]*?)<\\/is>/i.exec(body);
        var value = /<v\\b[^>]*>([\\s\\S]*?)<\\/v>/i.exec(body);
        if (typeMatch && typeMatch[1] === "s") {
          var index = value ? parseInt(kpXmlText(value[1]), 10) : NaN;
          return Number.isInteger(index) ? (sharedStrings[index] || "") : "";
        }
        if (inline) return kpXmlText(inline[1]);
        return value ? kpXmlText(value[1]) : "";
      }
      function kpWorksheetText(xml, sharedStrings) {
        var rows = [];
        var rowPattern = /<row\\b[^>]*>([\\s\\S]*?)<\\/row>/gi;
        var rowMatch;
        while ((rowMatch = rowPattern.exec(xml)) !== null) {
          var cells = [];
          var cellPattern = /<c\\b([^>]*)>([\\s\\S]*?)<\\/c>/gi;
          var cellMatch;
          while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) cells.push(kpCellValue(cellMatch[1], cellMatch[2], sharedStrings));
          rows.push(cells.join("\\t"));
        }
        return rows.join("\\n");
      }
      function kpLimitOfficeText(text) {
        if (text.length <= 200000) return text;
        var suffix = "…[截断:全文 " + text.length + " 字符]";
        return text.slice(0, Math.max(0, 200000 - suffix.length)) + suffix;
      }
      async function kpOfficeExtract(file, name) {
        var source = file && typeof file.arrayBuffer === "function" ? await file.arrayBuffer() : file;
        if (!(source instanceof ArrayBuffer)) throw new Error("无法读取 Office 文件");
        var lowerName = String(name || (file && file.name) || "").toLowerCase();
        var ext = lowerName.slice(lowerName.lastIndexOf(".") + 1);
        if (ext !== "docx" && ext !== "pptx" && ext !== "xlsx") throw new Error("不支持的 Office 格式:" + ext);
        var entries = kpZipEntries(source);
        function findEntry(path) {
          var lower = path.toLowerCase();
          return entries.find(function (entry) { return entry.name.toLowerCase() === lower; });
        }
        var text = "";
        if (ext === "docx") {
          var documentEntry = findEntry("word/document.xml");
          if (!documentEntry) throw new Error("docx 中没有 word/document.xml");
          var documentXml = await kpZipRead(source, documentEntry);
          text = kpXmlText(documentXml.replace(/<\\/w:p\\s*>/gi, "</w:p>\\n"));
        } else if (ext === "pptx") {
          var slides = kpNumberedOfficeEntries(entries, "ppt/slides/slide");
          if (!slides.length) throw new Error("pptx 中没有幻灯片条目");
          var pages = [];
          for (var p = 0; p < slides.length; p++) {
            var slideText = kpXmlText(await kpZipRead(source, slides[p].entry));
            pages.push(("【第" + slides[p].number + "页】\\n" + slideText).trim());
          }
          text = pages.join("\\n");
        } else {
          var sharedEntry = findEntry("xl/sharedStrings.xml");
          var sharedStrings = sharedEntry ? kpSharedStrings(await kpZipRead(source, sharedEntry)) : [];
          var sheets = kpNumberedOfficeEntries(entries, "xl/worksheets/sheet");
          if (!sheets.length) throw new Error("xlsx 中没有工作表条目");
          var sections = [];
          for (var s = 0; s < sheets.length; s++) {
            var sheetXml = await kpZipRead(source, sheets[s].entry);
            sections.push(("【Sheet " + sheets[s].number + "】\\n" + kpWorksheetText(sheetXml, sharedStrings)).trim());
          }
          text = sections.join("\\n");
        }
        return kpLimitOfficeText(text);
      }
`;
