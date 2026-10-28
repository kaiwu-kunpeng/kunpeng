export const part05: string = `  var termMobileNoticeShown = false;

  function termSetStatus(text) {
    var el = document.getElementById("kp-term-status");
    if (el) el.textContent = text;
  }

  function termFindByKey(key) {
    for (var i = 0; i < termTabs.length; i++) if (termTabs[i].key === key) return termTabs[i];
    return null;
  }

  function termSyncCount() {
    var sEl = document.getElementById("kp-term-session");
    if (sEl) sEl.textContent = termTabs.length ? termTabs.length + " 个会话" : "无会话";
  }

  function termFitTab(tab) {
    if (!tab || !tab.fit || !tab.term) return;
    if (!tab.wrapEl || tab.wrapEl.offsetWidth < 20 || tab.wrapEl.offsetHeight < 20) return;
    try { tab.fit.fit(); } catch (e) { return; }
    if (tab.ws && tab.ws.readyState === 1) {
      try { tab.ws.send(JSON.stringify({ type: "resize", cols: tab.term.cols, rows: tab.term.rows })); } catch (e) {}
    }
  }

  // 关页面/切走路由:断开所有 WS、销毁前端实例,但【不杀】后端会话(留存供重连)。
  function teardownTerminal() {
    if (termResizeHandler) { window.removeEventListener("resize", termResizeHandler); termResizeHandler = null; }
    if (termOfflineHandler) { window.removeEventListener("offline", termOfflineHandler); termOfflineHandler = null; }
    if (termOnlineHandler) { window.removeEventListener("online", termOnlineHandler); termOnlineHandler = null; }
    termTabs.forEach(function (tab) {
      if (tab.reconnectTimer) { clearTimeout(tab.reconnectTimer); tab.reconnectTimer = null; }
      if (tab.ro) { try { tab.ro.disconnect(); } catch (e) {} tab.ro = null; }
      if (tab.ws) { try { tab.ws.close(); } catch (e) {} tab.ws = null; }
      if (tab.term) { try { tab.term.dispose(); } catch (e) {} }
      if (tab.wrapEl && tab.wrapEl.parentNode) tab.wrapEl.parentNode.removeChild(tab.wrapEl);
    });
    termTabs = [];
    termActiveKey = null;
    termMobileNoticeShown = false;
  }

  function termRenderTabs() {
    var bar = document.getElementById("kp-term-tabs");
    if (!bar) return;
    bar.innerHTML = "";
    termTabs.forEach(function (tab, i) {
      var active = tab.key === termActiveKey;
      var btn = document.createElement("span");
      btn.className = "kp-term-tab" + (active ? " active" : "");
      var label = document.createElement("span");
      label.textContent = "终端 " + (i + 1);
      label.style.cursor = "pointer";
      label.onclick = function () { termActivate(tab.key); };
      var x = document.createElement("span");
      x.textContent = "×";
      x.title = "关闭并杀掉该会话进程";
      x.style.cssText = "opacity:.6;font-weight:700;padding:0 2px;cursor:pointer";
      x.onclick = function (ev) { ev.stopPropagation(); termCloseTab(tab.key); };
      btn.appendChild(label);
      btn.appendChild(x);
      bar.appendChild(btn);
    });
  }

  function termActivate(key) {
    termActiveKey = key;
    termTabs.forEach(function (tab) {
      var show = tab.key === key;
      if (tab.wrapEl) tab.wrapEl.style.display = show ? "block" : "none";
      if (show) {
        termFitTab(tab);
        if (tab.term) { try { tab.term.focus(); } catch (e) {} }
      }
    });
    termRenderTabs();
  }

  // 新建一个标签(sessionId 为空=新会话;非空=复用既有会话,带 &session= 重连回放滚屏)。
  function termOpenTab(sessionId) {
    var host = document.getElementById("kp-term-host");
    if (!host) return null;
    if (typeof window.Terminal !== "function") { termSetStatus("xterm 未加载"); return null; }
    var wrap = document.createElement("div");
    wrap.className = "kp-term-pane";
    wrap.style.cssText = "position:absolute;inset:8px;display:none";
    host.appendChild(wrap);
    var termStyle = getComputedStyle(document.documentElement);
    var termBg = termStyle.getPropertyValue("--term-bg").trim() || "#0b0e14";
    var termFg = termStyle.getPropertyValue("--term-fg").trim() || "#e6e1cf";
    var term = new window.Terminal({ cursorBlink: true, fontSize: 13, fontFamily: "Menlo, Monaco, monospace", scrollback: 5000, theme: { background: termBg, foreground: termFg } });
    var FitAddonCtor = window.FitAddon && window.FitAddon.FitAddon;
    var fit = FitAddonCtor ? new FitAddonCtor() : null;
    if (fit) term.loadAddon(fit);
    term.open(wrap);
    var tab = { key: termKeySeq++, id: sessionId || null, term: term, fit: fit, ws: null, wrapEl: wrap, ro: null, reconnectTimer: null, closing: false, exited: false };
    if (typeof ResizeObserver === "function") {
      var ro = new ResizeObserver(() => termFitTab(tab));
      ro.observe(wrap);
      tab.ro = ro;
    }
    term.onData(function (d) { if (tab.ws && tab.ws.readyState === 1) tab.ws.send(JSON.stringify({ type: "input", data: d })); });
    termTabs.push(tab);
    termConnectTab(tab);
    if (!termMobileNoticeShown && window.matchMedia && window.matchMedia("(hover: none)").matches) {
      termMobileNoticeShown = true;
      termSetStatus("手机端终端体验受限");
      term.write("\\r\\n\\x1b[90m[建议使用桌面浏览器操作终端]\\x1b[0m\\r\\n");
    }
    return tab;
  }

  function termConnectTab(tab) {
    if (tab.reconnectTimer) { clearTimeout(tab.reconnectTimer); tab.reconnectTimer = null; }
    var wsId = currentProjectId();
    var proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    var url = proto + "//" + window.location.host + "/api/workspace/" + encodeURIComponent(wsId) + "/pty?cols=" + tab.term.cols + "&rows=" + tab.term.rows + (tab.id ? "&session=" + encodeURIComponent(tab.id) : "");
    var ws = new WebSocket(url);
    tab.ws = ws;
    termSetStatus("连接中…");
    ws.onopen = function () {
      termSetStatus("已连接");
      if (tab.key === termActiveKey) {
        termFitTab(tab);
        try { tab.term.focus(); } catch (e) {}
      }
    };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === "session") {
        // 重连拿回的 id 和请求的不一致 = 原会话已死(serve 重启且未能复活)→ 明示,绝不静默换空白会话
        if (tab.id && m.id !== tab.id) {
          tab.term.write("\\r\\n\\x1b[33m[serve 已重启，原会话已丢失，已为你开新会话]\\x1b[0m\\r\\n");
          termSetStatus("serve 已重启，原会话丢失，已开新会话");
        } else if (tab.id && m.revived) {
          termSetStatus("serve 已重启，会话已恢复");
        }
        tab.id = m.id; termRenderTabs();
      }
      else if (m.type === "output") { tab.term.write(m.data); }
      else if (m.type === "exit") { tab.exited = true; tab.term.write("\\r\\n\\x1b[90m[进程已退出 code=" + (m.code != null ? m.code : "?") + "]\\x1b[0m\\r\\n"); termSetStatus("已退出"); }
    };
    ws.onclose = function () { if (tab.ws === ws) { tab.ws = null; if (!tab.closing && !tab.exited) termScheduleReconnectTab(tab); } };
    ws.onerror = function () { if (tab.ws === ws) { termSetStatus("连接错误，已断开"); } };
  }

  // 瞬断/网络抖动:单标签重连(带 session= 复用,回放滚屏);主动关闭或正常退出不重连。
  function termScheduleReconnectTab(tab) {
    if (currentRoute() !== "#/terminal") return;
    if (tab.closing || tab.exited || tab.reconnectTimer) return;
    termSetStatus("已断开，重连中…");
    tab.reconnectTimer = setTimeout(function () {
      tab.reconnectTimer = null;
      if (tab.closing || tab.exited || currentRoute() !== "#/terminal") return;
      if (navigator.onLine === false) { termScheduleReconnectTab(tab); return; }
      termConnectTab(tab);
    }, navigator.onLine === false ? 1000 : 800);
  }

  // 主动点 × 关闭:DELETE 杀掉后端会话进程,再销毁前端标签。
  function termCloseTab(key) {
    var tab = termFindByKey(key);
    if (!tab) return;
    tab.closing = true;
    if (tab.reconnectTimer) { clearTimeout(tab.reconnectTimer); tab.reconnectTimer = null; }
    if (tab.id) {
      var wsId = currentProjectId();
      try {
        fetch("/api/workspace/" + encodeURIComponent(wsId) + "/pty/sessions/" + encodeURIComponent(tab.id), { method: "DELETE" }).catch(function () {});
      } catch (e) {}
    }
    if (tab.ws) { try { tab.ws.close(); } catch (e) {} tab.ws = null; }
    if (tab.ro) { try { tab.ro.disconnect(); } catch (e) {} tab.ro = null; }
    if (tab.term) { try { tab.term.dispose(); } catch (e) {} }
    if (tab.wrapEl && tab.wrapEl.parentNode) tab.wrapEl.parentNode.removeChild(tab.wrapEl);
    termTabs = termTabs.filter(function (t) { return t.key !== key; });
    if (termActiveKey === key) termActiveKey = termTabs.length ? termTabs[termTabs.length - 1].key : null;
    if (termActiveKey) termActivate(termActiveKey); else { termRenderTabs(); termSetStatus("无会话"); }
    termSyncCount();
  }

  function termNew() {
    var tab = termOpenTab(null);
    if (tab) termActivate(tab.key);
    termSyncCount();
  }

  function termWireGlobalEvents() {
    if (termResizeHandler) window.removeEventListener("resize", termResizeHandler);
    termResizeHandler = function () {
      var tab = termFindByKey(termActiveKey);
      if (!tab) return;
      termFitTab(tab);
    };
    window.addEventListener("resize", termResizeHandler);
    if (termOfflineHandler) window.removeEventListener("offline", termOfflineHandler);
    if (termOnlineHandler) window.removeEventListener("online", termOnlineHandler);
    termOfflineHandler = function () { termSetStatus("已断开"); termTabs.forEach(termScheduleReconnectTab); };
    termOnlineHandler = function () { termTabs.forEach(termScheduleReconnectTab); };
    window.addEventListener("offline", termOfflineHandler);
    window.addEventListener("online", termOnlineHandler);
  }

  function initTerminalNow() {
    var host = document.getElementById("kp-term-host");
    if (!host) return;
    teardownTerminal();
    host.innerHTML = "";
    termWireGlobalEvents();
    var newBtn = document.getElementById("kp-term-new");
    if (newBtn) newBtn.onclick = function () { termNew(); };
    var wsId = currentProjectId();
    termSetStatus("加载会话…");
    // 找回旧窗口:列出该工作区存活会话,各恢复成一个标签;一个都没有则新开一个。
    fetch("/api/workspace/" + encodeURIComponent(wsId) + "/pty/sessions").then(function (r) { return r.json(); }).then(function (data) {
      if (currentRoute() !== "#/terminal") return;
      var sessions = (data && data.ok && data.sessions) ? data.sessions.filter(function (s) { return s.alive; }) : [];
      if (sessions.length) sessions.forEach(function (s) { termOpenTab(s.id); });
      else termOpenTab(null);
      if (termTabs.length) termActivate(termTabs[0].key);
      termSyncCount();
    }).catch(function () {
      if (currentRoute() !== "#/terminal") return;
      termOpenTab(null);
      if (termTabs.length) termActivate(termTabs[0].key);
      termSyncCount();
    });
  }

  function initTerminal() {
    var host = document.getElementById("kp-term-host");
    if (!host) return;
    kpEnsureVendor("term").then(initTerminalNow).catch(function () { termSetStatus("xterm 加载失败"); });
  }

  async function loadOverviewLiveSessions() {
    var live = document.querySelector("[data-live-sessions]");
    if (!live) return;
    live.textContent = "";
    var wsId = currentProjectId();
    if (!wsId) return;
    try {
      var res = await fetch("/api/workspace/" + encodeURIComponent(wsId) + "/pty/sessions");
      if (!res.ok) return;
      var data = await res.json();
      if (!data || data.ok !== true || !Array.isArray(data.sessions)) return;
      var count = data.sessions.filter(function (session) { return session && session.alive; }).length;
      if (currentRoute() !== "#/overview") return;
      live = document.querySelector("[data-live-sessions]");
      if (live) live.textContent = count > 0 ? count + " 个终端会话在跑" : "";
    } catch (_err) {}
  }

  function archRemoveLayerBands(cy) {
    if (!cy) return;
    cy.nodes(".arch-layer-band").remove();
  }

  function archCreateLayerBands(cy) {
    archRemoveLayerBands(cy);
    var boxes = [];
    var minX = Infinity;
    var maxX = -Infinity;
    for (var k = 0; k < 5; k++) {
      var layerNodes = cy.nodes('[layer='+k+']');
      if (!layerNodes.length) continue;
      var box = cy.nodes('[layer='+k+']').boundingBox();
      boxes.push({ layer: k, box: box });
      minX = Math.min(minX, box.x1);
      maxX = Math.max(maxX, box.x2);
    }
    if (!boxes.length || !isFinite(minX) || !isFinite(maxX)) return;
    var sidePadding = 34;
    var rowPadding = 24;
    boxes.forEach(function (entry) {
      var box = entry.box;
      cy.add({
        group: "nodes",
        data: {
          id: "arch-layer-band-" + entry.layer,
          label: archLayerLabels[entry.layer],
          bandWidth: Math.max(1, maxX - minX + sidePadding * 2),
          bandHeight: Math.max(1, box.h + rowPadding * 2)
        },
        position: { x: (minX + maxX) / 2, y: (box.y1 + box.y2) / 2 },
        classes: "arch-layer-band",
        locked: true,
        selectable: false,
        grabbable: false
      });
    });
  }

  function archLayoutOptions(useElk, mode) {
    var archMobile = (window.innerWidth || 9999) <= 768;
    if (!useElk) return { name: "cose", animate: false, padding: 20 };
    var byLayer = mode !== "cluster";
    if (byLayer) {
      return {
        name: "elk",
        nodeLayoutOptions: function (n) {
          return { "elk.partitioning.partition": String(n.data("layer")) };
        },
        elk: {
          algorithm: "layered",
          "elk.direction": "DOWN",
          "elk.partitioning.activate": true,
          "elk.layered.spacing.nodeNodeBetweenLayers": 90,
          "elk.spacing.nodeNode": 40,
          "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
          "elk.layered.cycleBreaking.strategy": "GREEDY_MODEL_ORDER",
          "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES"
        }
      };
    }
    return {
      name: "elk",
      nodeLayoutOptions: function () { return {}; },
      elk: {
        algorithm: "layered",
        "elk.direction": archMobile ? "DOWN" : "RIGHT",
        "elk.partitioning.activate": false,
        "elk.layered.spacing.nodeNodeBetweenLayers": archMobile ? 40 : 70,
        "elk.spacing.nodeNode": archMobile ? 26 : 38,
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.layered.cycleBreaking.strategy": "GREEDY_MODEL_ORDER",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES"
      }
    };
  }

  function archSyncLayoutButtons(mode) {
    document.querySelectorAll("[data-arch-layout]").forEach(function (button) {
      var active = button.getAttribute("data-arch-layout") === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function archRunLayout(cy, useElk, mode) {
    if (!cy) return;
    archRemoveLayerBands(cy);
    archSyncLayoutButtons(mode);
    cy.one("layoutstop", function () {
      if (mode === "layer") archCreateLayerBands(cy);
      try { cy.fit(undefined, 30); } catch (_fitErr) {}
    });
    cy.layout(archLayoutOptions(useElk, mode)).run();
  }

  function archEnsureToolbar(el, useElk) {
    if (!el || !el.parentNode) return;
    var toolbar = el.parentNode.querySelector(".arch-layout-toggle");
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "arch-layout-toggle";
      toolbar.setAttribute("role", "group");
      toolbar.setAttribute("aria-label", "架构布局方式");
      toolbar.innerHTML = '<span class="arch-layout-label">布局</span><button type="button" class="arch-layout-btn" data-arch-layout="layer">按层</button><button type="button" class="arch-layout-btn" data-arch-layout="cluster">按簇</button>';
      el.parentNode.insertBefore(toolbar, el);
    }
    toolbar.querySelectorAll("[data-arch-layout]").forEach(function (button) {
      button.onclick = function () {
        archLayoutMode = button.getAttribute("data-arch-layout") === "cluster" ? "cluster" : "layer";
        archRunLayout(window.__archCy, useElk, archLayoutMode);
      };
    });
    archSyncLayoutButtons(archLayoutMode);
  }

  function archResetFocus(cy) {
    cy.elements().removeClass("arch-dim arch-focus");
  }

  function archFocusNode(cy, node) {
    archResetFocus(cy);
    var related = node.union(node.predecessors()).union(node.successors());
    cy.elements().not(".arch-layer-band").addClass("arch-dim");
    related.removeClass("arch-dim").addClass("arch-focus");
  }

  function archOpenNode(node) {
    var now = Date.now();
    var openedAt = Number(node.scratch("_archOpenedAt") || 0);
    if (now - openedAt < 180) return;
    node.scratch("_archOpenedAt", now);
    var detail = node.data("detail") || "";
    var route = node.data("route") || "";
    overlayHtml("节点 · " + node.data("label"), '<div style="font-size:13px;line-height:1.6">' + (detail ? escHtml(detail) : "（无说明）") + (node.data("metric") ? '<div style="margin-top:8px;color:var(--muted)">当前:' + escHtml(node.data("metric")) + '</div>' : '') + (route ? '<div style="margin-top:10px"><a href="' + escHtml(route) + '">打开对应面板 →</a></div>' : '') + '</div>');
  }

  function initArchitectureNow() {
    var el = document.getElementById("cy-arch");
    if (!el) return;
    if (typeof window.cytoscape !== "function") return;
    var raw = el.getAttribute("data-arch") || "{}";
    var graph;
    try {
      graph = JSON.parse(raw);
    } catch (_err) {
      return;
    }
    var nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    var edges = Array.isArray(graph.edges) ? graph.edges : [];
    if (window.__archCy && typeof window.__archCy.destroy === "function") {
      window.__archCy.destroy();
    }
    // ELK 五层依赖向下布局；按簇模式关闭 partitioning，保留原平铺布局作为对照。
    var useElk = typeof window.cytoscapeElk !== "undefined" || (window.cytoscape && window.cytoscape.prototype && false);
    try { if (window.cytoscape && window.cytoscapeElk) window.cytoscape.use(window.cytoscapeElk); useElk = true; } catch (_e) { useElk = false; }
    archLayoutMode = "layer";
    var kpArchVars = getComputedStyle(document.documentElement);
    var kpArchColors = {
      node1: kpArchVars.getPropertyValue("--arch-node-1").trim(),
      node2: kpArchVars.getPropertyValue("--arch-node-2").trim(),
      node3: kpArchVars.getPropertyValue("--arch-node-3").trim(),
      node4: kpArchVars.getPropertyValue("--arch-node-4").trim(),
      node5: kpArchVars.getPropertyValue("--arch-node-5").trim(),
      node6: kpArchVars.getPropertyValue("--arch-node-6").trim(),
      node7: kpArchVars.getPropertyValue("--arch-node-7").trim(),
      ink: kpArchVars.getPropertyValue("--arch-node-ink").trim(),
      edge: kpArchVars.getPropertyValue("--arch-edge").trim(),
      warn: kpArchVars.getPropertyValue("--warn").trim()
    };
    window.__archCy = window.cytoscape({
      container: el,
      elements: {
        nodes: nodes.map(function (n) {
          return {
            data: { id: n.id, label: archNodeLabel(n), layer: Number(n.layer), metric: (n && n.metric) ? String(n.metric) : "", detail: (n && n.detail) ? String(n.detail) : "", route: (n && n.route) ? String(n.route) : "" },
            classes: Array.isArray(n.classes) ? n.classes.join(" ") : ""
          };
        }),
        edges: edges.map(function (e, i) {
          var edgeData = { id: "e" + i, source: e.source, target: e.target };
          if (e.feedback === true) edgeData.feedback = true;
          return {
            data: edgeData,
            classes: Array.isArray(e.classes) ? e.classes.join(" ") : ""
          };
        })
      },
      layout: { name: "preset" },
      style: [
        {
          selector: "node",
          style: {
            "shape": "round-rectangle",
            "width": 148,
            "height": "data(metric)" ? 56 : 46,
            "label": function (ele) { var m = ele.data("metric"); return ele.data("label") + (m ? "\\n" + m : ""); },
            "text-valign": "center",
            "text-halign": "center",
            "font-size": 12.5,
            "font-weight": 600,
            "line-height": 1.35,
            "color": kpArchColors.ink,
            "background-color": "#ffffff",
            "border-color": kpArchColors.edge,
            "border-width": 2,
            "border-opacity": 1,
            "text-wrap": "wrap",
            "text-max-width": 134
          }
        },
        // 簇配色(左边色条式:用 border + 浅底区分七簇)
        { selector: ".c-core", style: { "background-color": kpArchColors.node1, "border-color": "#3b82f6" } },
        { selector: ".c-harness", style: { "background-color": kpArchColors.node2, "border-color": "#8b5cf6" } },
        { selector: ".c-observe", style: { "background-color": kpArchColors.node3, "border-color": "#06b6d4" } },
        { selector: ".c-security", style: { "background-color": kpArchColors.node4, "border-color": "#f97316" } },
        { selector: ".c-flywheel", style: { "background-color": kpArchColors.node5, "border-color": "#14b8a6" } },
        { selector: ".c-evolution", style: { "background-color": kpArchColors.node6, "border-color": "#a855f7" } },
        { selector: ".c-cross", style: { "background-color": kpArchColors.node7, "border-color": "#ec4899" } },
        { selector: ".gate", style: { "shape": "diamond", "width": 150, "height": 64 } },
        { selector: ".terminal", style: { "border-width": 3 } },
        // 健康状态盖在簇色之上(状态优先:在跑/等门/失败更醒目)
        { selector: ".s-running", style: { "background-color": "#dbeafe", "border-color": "#2563eb", "color": kpArchColors.ink } },
        { selector: ".s-idle", style: { "color": "#475569" } },
        { selector: ".s-done", style: { "background-color": "#dcfce7", "border-color": "#16a34a" } },
        { selector: ".s-waiting", style: { "background-color": "#fef3c7", "border-color": "#d97706" } },
        { selector: ".s-failed", style: { "background-color": "#fee2e2", "border-color": "#dc2626" } },
        {
          selector: ".arch-layer-band",
          style: {
            "shape": "round-rectangle",
            "width": "data(bandWidth)",
            "height": "data(bandHeight)",
            "label": "data(label)",
            "text-halign": "left",
            "text-valign": "top",
            "text-margin-x": 12,
            "text-margin-y": 10,
            "font-size": 13,
            "font-weight": 700,
            "color": kpArchColors.ink,
            "background-color": kpArchVars.getPropertyValue("--card").trim(),
            "background-opacity": 0.48,
            "border-color": kpArchVars.getPropertyValue("--line").trim(),
            "border-width": 1,
            "events": "no",
            "z-index": -10
          }
        },
        {
          selector: "edge",
          style: {
            "width": 2,
            "line-color": kpArchColors.edge,
            "target-arrow-color": kpArchColors.edge,
            "target-arrow-shape": "triangle",
            "curve-style": "taxi",
            "taxi-direction": "downward",
            "taxi-turn": 24,
            "arrow-scale": 0.9
          }
        },
        { selector: "edge.repair", style: { "line-style": "dashed", "line-color": "#ef4444", "target-arrow-color": "#ef4444" } },
        { selector: "edge.evolution", style: { "line-style": "dashed", "line-color": "#a855f7", "target-arrow-color": "#a855f7" } },
        { selector: "edge.flywheel", style: { "line-color": "#14b8a6", "target-arrow-color": "#14b8a6" } },
        { selector: "edge.harness", style: { "line-color": "#8b5cf6", "target-arrow-color": "#8b5cf6" } },
        { selector: "edge.observe", style: { "line-style": "dotted", "line-color": "#06b6d4", "target-arrow-color": "#06b6d4" } },
        { selector: "edge.security", style: { "line-color": "#f97316", "target-arrow-color": "#f97316" } },
        { selector: "edge.cross", style: { "line-style": "dashed", "line-color": "#ec4899", "target-arrow-color": "#ec4899" } },
        { selector: "edge[feedback]", style: { "line-style": "dashed", "line-color": kpArchColors.warn, "target-arrow-color": kpArchColors.warn } },
        { selector: ".flowing", style: { "line-style": "dashed", "line-dash-pattern": [8, 6] } },
        { selector: ".arch-dim", style: { "opacity": 0.15 } },
        { selector: ".arch-focus", style: { "opacity": 1 } }
      ],
      userZoomingEnabled: true,
      userPanningEnabled: true
    });
    archEnsureToolbar(el, useElk);
    var lastTapId = "";
    var lastTapAt = 0;
    // 单击只聚焦上下游；双击才打开下钻详情；点空白还原。
    window.__archCy.on("tap", "node", function (evt) {
      var n = evt.target;
      var cy = window.__archCy;
      archFocusNode(cy, n);
      var now = Date.now();
      if (lastTapId === n.id() && now - lastTapAt <= 360) archOpenNode(n);
      lastTapId = n.id();
      lastTapAt = now;
    });
    window.__archCy.on("dbltap dblclick", "node", function (evt) { archOpenNode(evt.target); });
    window.__archCy.on("tap", function (evt) { if (evt.target === window.__archCy) archResetFocus(window.__archCy); });
    archRunLayout(window.__archCy, useElk, archLayoutMode);
    startArchEffects();
  }

  function initArchitecture() {
    var el = document.getElementById("cy-arch");
    if (!el) return;
    kpEnsureVendor("graph").then(initArchitectureNow).catch(function () {});
  }

  function archNodeLabel(n) {
    var badge = n && n.badge != null && n.badge > 0 ? " (" + n.badge + ")" : "";
    return String((n && n.label) || "") + badge;
  }

  function archNodeIsPulsing(node) {
    return node && (node.hasClass("s-running") || node.hasClass("s-waiting"));
  }

  function archEdgeIsFlowing(edge) {
    if (!edge || edge.empty()) return false;
    return edge.source().hasClass("s-running") || edge.target().hasClass("s-running");
  }

  function pulseNode(node) {
    if (!archNodeIsPulsing(node)) {
      if (node && node.removeScratch) node.removeScratch("_archPulse");
      return;
    }
    if (node.scratch("_archPulse")) return;
    node.scratch("_archPulse", true);
    node.animation({
      style: { "border-width": 10, "border-opacity": 0.25 },
      duration: 760
    }).play().promise("complete").then(function () {
      if (archNodeIsPulsing(node)) node.style({ "border-width": 3, "border-opacity": 1 });
      else node.style({ "border-width": 1.5, "border-opacity": 1 });
      node.removeScratch("_archPulse");
      pulseNode(node);
    });
  }

  function flowEdge(edge, i) {
    if (!archEdgeIsFlowing(edge)) {
      if (edge && edge.removeScratch) edge.removeScratch("_archFlow");
      if (edge && edge.removeClass) edge.removeClass("flowing");
      if (edge && edge.removeStyle) edge.removeStyle("line-dash-offset line-dash-pattern");
      return;
    }
    edge.addClass("flowing");
    if (edge.scratch("_archFlow")) return;
    edge.scratch("_archFlow", true);
    edge.animation({
      style: { "line-dash-offset": -16 * i },
      duration: 900
    }).play().promise("complete").then(function () {
      edge.removeScratch("_archFlow");
      flowEdge(edge, i + 1);
    });
  }

  function resetArchEdge(edge) {
    if (archEdgeIsFlowing(edge)) flowEdge(edge, 1);
    else {
      edge.removeClass("flowing");
      edge.removeStyle("line-dash-offset line-dash-pattern");
    }
  }

  function startArchEffects() {
    var cy = window.__archCy;
    if (!cy) return;
    cy.nodes().forEach(function (node) { pulseNode(node); });
    cy.edges().forEach(function (edge) { resetArchEdge(edge); });
  }

  function updateArchitecture(graph) {
    var cy = window.__archCy;
    if (!cy || !graph) return;
    var nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    nodes.forEach(function (n) {
      var node = cy.$id(String(n.id || ""));
      if (!node || node.empty()) return;
      node.data("label", archNodeLabel(n));
      node.data("metric", (n && n.metric) ? String(n.metric) : "");
      node.data("route", (n && n.route) ? String(n.route) : "");
      node.removeClass("s-running s-idle s-waiting s-done s-failed");
      node.addClass("s-" + String(n.state || "idle"));
      if (archNodeIsPulsing(node)) pulseNode(node);
      else {
        node.removeScratch("_archPulse");
        node.style({ "border-opacity": 1 });
      }
    });
    cy.edges().forEach(function (edge) { resetArchEdge(edge); });
  }

  async function renderRoute() {
    var route = currentRoute();
    if ((window.location.hash || "#/workbench") !== route) {
      window.location.hash = route;
    }
    if (!latestState) await loadState();
    setSidebarActive(route);
    syncWorkspaceSwitcher(route);
    await renderView(route);
    if (route === "#/inbox" || route === legacyReviewInboxRoute) kpInboxMarkVisibleSeen();
    await initDesignPresets();
    if (route === "#/tasks") {
      await loadTodaySection();
      await loadTaskBoard();
    }
    if (sbPollTimer) { clearInterval(sbPollTimer); sbPollTimer = null; }
    if (sbStream) { try { sbStream.close(); } catch (e) {} sbStream = null; }
    wbStreams.forEach(function (s) { try { s.close(); } catch (e) {} });
    wbStreams = [];
    if (route !== "#/terminal") teardownTerminal();
    if (flowsPollTimer) { clearInterval(flowsPollTimer); flowsPollTimer = null; }
    if (archPollTimer) { clearInterval(archPollTimer); archPollTimer = null; }
    if (taskBoardPollTimer) { clearInterval(taskBoardPollTimer); taskBoardPollTimer = null; }
    if (route === "#/knowledge") {
      await knowledgeLoad("");
      await resurfaceLoad();
      await tagcloudLoad();
    }
    if (route === "#/library") {
      await libraryLoad();
    }
    if (route === "#/inbox" || route === legacyReviewInboxRoute) {
      await gatesDiagnosisLoad();
    }
    if (route === "#/overview") {
      await escapeRateLoad();
      await loadOverviewLiveSessions();
    }
    if (route === "#/loops") {
      await opsTimelineLoad();
    }
    if (route === "#/architecture") {
      initArchitecture();
      archPollTimer = setInterval(async function () {
        if (currentRoute() !== "#/architecture") { clearInterval(archPollTimer); archPollTimer = null; return; }
        try {
          var res = await fetch("/api/arch-graph");
          var g = await res.json();
          updateArchitecture(g);
        } catch (_err) {}
      }, 4000);
    }
    if (/^#\\/project\\/[^/]+\\/flows$/.test(route)) {
      await gatesDiagnosisLoad();
      // 开发流页:~4s 自刷新(仿 switchboard 轮询),否则流水线不动;切走清掉。
      flowsPollTimer = setInterval(function () {
        var r = currentRoute();
        if (!/^#\\/project\\/[^/]+\\/flows$/.test(r)) { clearInterval(flowsPollTimer); flowsPollTimer = null; return; }
        renderView(r).then(function () { return gatesDiagnosisLoad(); });
      }, 4000);
    }
    if (route === "#/tasks") {
      taskBoardPollTimer = setInterval(function () {
        if (currentRoute() !== "#/tasks" || !document.querySelector("[data-taskboard-list]")) {
          clearInterval(taskBoardPollTimer);
          taskBoardPollTimer = null;
          return;
        }
        loadTaskBoard().catch(function () {});
      }, 5000);
    }
    if (route === "#/workbench") {
      bindWorkbench();
    }
    if (route === "#/settings") {
      try {
        var nc = await (await fetch("/api/settings/notify")).json();
        if (nc && nc.ok) document.querySelectorAll("[data-nf]").forEach(function (node) { var k = node.getAttribute("data-nf"); if (nc[k] != null) node.value = nc[k]; });
      } catch (_e) {}
      await initPushSetting();
      await loadAccounts();
    }
    if (route === "#/terminal") {
      initTerminal();
    }
    if (route === "#/switchboard") {
      await switchboardLoad();
      if (window.EventSource) {
        sbStream = new EventSource("/api/switchboard/stream");
        sbStream.addEventListener("changed", function () { if (currentRoute() === "#/switchboard") switchboardLoad(); });
      }
      sbPollTimer = setInterval(function () {
        if (currentRoute() !== "#/switchboard") { clearInterval(sbPollTimer); sbPollTimer = null; if (sbStream) { try { sbStream.close(); } catch (e) {} sbStream = null; } return; }
        switchboardLoad();
      }, 60000);
    }
  }

  function ensurePalette() {
    if (paletteEl) return paletteEl;
    paletteEl = document.createElement("div");
    paletteEl.id = "command-palette";
    paletteEl.hidden = true;
    paletteEl.innerHTML =
      '<div class="kp-command-backdrop" data-command-close="true"></div>' +
      '<div class="kp-command-panel" role="dialog" aria-modal="true" aria-label="Command palette">' +
      '<input class="kp-command-input" type="text" placeholder="Jump to..." autocomplete="off">' +
      '<div class="kp-command-list"></div>' +
      '</div>';
    document.body.appendChild(paletteEl);
    paletteEl.addEventListener("click", function (event) {
      var target = event.target;
      if (target && target.getAttribute && target.getAttribute("data-command-close") === "true") {
        closePalette();
        return;
      }
      var item = target && target.closest ? target.closest("[data-command-route]") : null;
      if (!item) return;
      window.location.hash = item.getAttribute("data-command-route") || "#/overview";
      closePalette();
    });
    var input = paletteEl.querySelector(".kp-command-input");
    if (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          closePalette();
          return;
        }
        if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
        var first = paletteEl.querySelector("[data-command-route]");
        if (!first) return;
        window.location.hash = first.getAttribute("data-command-route") || "#/overview";
        closePalette();
      });
    }
    return paletteEl;
  }

  function commandItem(label, route) {
    return '<button type="button" class="kp-command-item" data-command-route="' + escHtml(route) + '">' + escHtml(label) + '</button>';
  }

  function openPalette() {
    var el = ensurePalette();
    var projects = readProjects(latestState);
    var html = commandItem("Overview", "#/overview") + commandItem("Inbox", "#/inbox");
    projects.forEach(function (project) {
      html += commandItem("Project " + project.name, "#/project/" + encodeURIComponent(project.id));
      html += commandItem("产品 · " + project.name, "#/project/" + encodeURIComponent(project.id) + "/product");
    });
    var list = el.querySelector(".kp-command-list");
    if (list) list.innerHTML = html;
    el.hidden = false;
    var input = el.querySelector(".kp-command-input");
    if (input) {
      input.value = "";
      input.focus();
    }
  }

  function closePalette() {
    if (paletteEl) paletteEl.hidden = true;
  }

  function togglePalette() {
    var el = ensurePalette();
    if (el.hidden) openPalette();
    else closePalette();
  }

  function toast(msg) {
    try {
      var el = document.createElement("div");
      el.className = "kp-toast";
      el.textContent = String(msg || "");
      el.setAttribute("role", "status");
      el.style.position = "fixed";
      el.style.right = "18px";
      el.style.bottom = "18px";
      el.style.zIndex = "9999";
      el.style.maxWidth = "360px";
      el.style.padding = "10px 12px";
      el.style.borderRadius = "8px";
      el.style.fontSize = "13px";
      el.style.boxShadow = "0 12px 28px rgba(0,0,0,.22)";
      el.style.transition = "opacity .22s ease";
      document.body.appendChild(el);
      window.setTimeout(function () {
        el.style.opacity = "0";
        window.setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 260);
      }, 2500);
    } catch (_err) {
      return;
    }
  }

  function overlay(title, text) {
    try {
      var wrap = document.createElement("div");
      wrap.className = "kp-overlay";
      wrap.style.position = "fixed";
      wrap.style.inset = "0";
      wrap.style.zIndex = "9998";
      wrap.style.background = "rgba(5, 10, 20, .42)";
      wrap.style.display = "flex";
      wrap.style.alignItems = "center";
      wrap.style.justifyContent = "center";
      wrap.style.padding = "24px";

      var panel = document.createElement("div");
      panel.style.width = "min(880px, 100%)";
      panel.style.maxHeight = "80vh";
      panel.style.overflow = "auto";
      panel.style.borderRadius = "10px";
      panel.style.background = "var(--card)";
      panel.style.color = "var(--ink)";
      panel.style.boxShadow = "var(--shadow-pop)";

      var head = document.createElement("div");
      head.style.display = "flex";
      head.style.alignItems = "center";
      head.style.gap = "12px";
      head.style.padding = "14px 16px";
      head.style.borderBottom = "1px solid var(--line)";

      var h = document.createElement("strong");
      h.textContent = String(title || "");
      h.style.flex = "1";

      var close = document.createElement("button");
      close.type = "button";
      close.textContent = "关闭";
      close.style.border = "1px solid var(--line)";
      close.style.background = "var(--card)";
      close.style.borderRadius = "6px";
      close.style.padding = "6px 10px";
      close.addEventListener("click", function () {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      });

      var body = document.createElement("pre");
      body.textContent = String(text == null ? "" : text);
      body.style.margin = "0";
      body.style.padding = "16px";
      body.style.whiteSpace = "pre-wrap";
      body.style.font = "12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

      head.appendChild(h);
      head.appendChild(close);
      panel.appendChild(head);
      panel.appendChild(body);
      wrap.appendChild(panel);
      wrap.addEventListener("click", function (event) {
        if (event.target === wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
      });
      document.body.appendChild(wrap);
    } catch (_err) {
      return;
    }
  }

  // 同 overlay 但 body 用 HTML(给 trajectory 时间线等富渲染);html 必须是可信内容(我们自己拼,escHtml 过用户串)。
  function overlayHtml(title, html) {
    try {
      var wrap = document.createElement("div");
      wrap.className = "kp-overlay";
      wrap.style.cssText = "position:fixed;inset:0;z-index:9998;background:rgba(5,10,20,.42);display:flex;align-items:center;justify-content:center;padding:24px";
      var panel = document.createElement("div");
      panel.style.cssText = "width:min(720px,100%);max-height:80vh;overflow:auto;border-radius:10px;background:var(--card);color:var(--ink);box-shadow:var(--shadow-pop)";
      var head = document.createElement("div");
      head.style.cssText = "display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line)";
      var h = document.createElement("strong"); h.textContent = String(title || ""); h.style.flex = "1";
      var close = document.createElement("button");
      close.type = "button"; close.textContent = "关闭";
      close.style.cssText = "border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:6px;padding:6px 10px;cursor:pointer";
      close.addEventListener("click", function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); });
      var body = document.createElement("div");
      body.style.cssText = "padding:16px";
      body.innerHTML = html;
      head.appendChild(h); head.appendChild(close);
      panel.appendChild(head); panel.appendChild(body); wrap.appendChild(panel);
      wrap.addEventListener("click", function (event) { if (event.target === wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap); });
      document.body.appendChild(wrap);
    } catch (_err) { return; }
  }

  // 在 latestState 里按 flowId 找流(跨项目),用于 trajectory 时间线渲染。
  function findFlowById(id) {
    var projects = (latestState && latestState.projects) || [];
    for (var i = 0; i < projects.length; i++) {
      var flows = (projects[i].state && projects[i].state.flows) || [];
      for (var j = 0; j < flows.length; j++) { if (flows[j].flowId === id) return flows[j]; }
    }
    return null;
  }

  // trajectory 步骤事件流:把 FlowState.history(+stageTokens/stageBackends/status) 渲成时间线。
  function trajectoryHtml(flow) {
    if (!flow) return '<div class="kp-traj-empty">未找到该流的轨迹（可能已超出最近 40 条）。</div>';
    var hist = Array.isArray(flow.history) ? flow.history : [];
    var tokens = flow.stageTokens || {};
    var backs = flow.stageBackends || {};
    var flowStatus = String(flow.status || "");
    var statusClass = flowStatus === "running"
      ? "is-running"
      : (flowStatus === "verified" || flowStatus === "done")
        ? "is-verified"
        : (flowStatus === "rolled-back" || flowStatus === "failed")
          ? "is-failed"
          : "is-muted";
    var rows = hist.map(function (h, i) {
      var nextAt = i + 1 < hist.length ? hist[i + 1].at : flow.updatedAt;
      var durMs = (nextAt && h.at) ? Math.max(0, nextAt - h.at) : 0;
      var dur = durMs >= 1000 ? (durMs / 1000).toFixed(1) + "s" : durMs + "ms";
      var t = new Date(h.at);
      var hhmmss = t.toTimeString().slice(0, 8);
      var tk = tokens[h.stage] ? " · " + tokens[h.stage] + " tok" : "";
      var bk = backs[h.stage] ? " · " + escHtml(backs[h.stage]) : "";
      var last = i === hist.length - 1;
      return '<div class="kp-traj-row">'
        + '<div class="kp-traj-track"><span class="kp-traj-dot ' + (last ? statusClass : "is-muted") + '"></span>' + (last ? "" : '<span class="kp-traj-line"></span>') + '</div>'
        + '<div class="kp-traj-content"><div class="kp-traj-stage">' + escHtml(h.stage) + '</div>'
        + '<div class="kp-traj-meta">' + hhmmss + ' · ' + dur + tk + bk + '</div></div></div>';
    }).join("");
    var headLine = '<div class="kp-traj-head">'
      + '状态 <b class="kp-traj-status ' + statusClass + '">' + escHtml(flow.status || "") + '</b>'
      + (flow.backend ? ' · 后端 ' + escHtml(flow.backend) : '')
      + (flow.tokensUsed ? ' · 累计 ' + flow.tokensUsed + ' tok' : '')
      + (flow.blocker ? '<div class="kp-traj-alert">卡点：' + escHtml(flow.blocker) + '</div>' : '')
      + (flow.humanGate ? '<div class="kp-traj-alert">待人工：' + escHtml(flow.humanGate.what || flow.humanGate.gate || "") + '</div>' : '')
      + '</div>';
    var fb = '<div class="kp-traj-feedback">'
      + '<div class="kp-traj-feedback-title">审查意见 → 回灌重做</div>'
      + '<div class="kp-traj-feedback-help">写下对这次实现的修改意见(可带 文件:行)，提交后点「续跑」会把意见喂回 implement 重做。</div>'
      + '<textarea class="kp-traj-feedback-input" id="kp-fb-input" rows="3" placeholder="例：a.ts:12 改用 const；补边界测试"></textarea>'
      + '<div class="kp-traj-feedback-actions">'
      + '<button class="pick" data-action="submit-feedback" data-flow="' + escHtml(flow.flowId) + '">提交意见</button>'
      + '<span class="kp-traj-feedback-message" id="kp-fb-msg"></span></div></div>';
    return headLine + '<div class="kp-traj-timeline">' + (rows || '<div class="kp-traj-empty">暂无阶段记录</div>') + '</div>' + fb;
  }

  function editablePlanOverlay(initialText) {
    return new Promise(function (resolve) {
      try {
        var done = false;
        var wrap = document.createElement("div");
        wrap.className = "kp-overlay kp-plan-overlay";
        wrap.style.position = "fixed";
        wrap.style.inset = "0";
        wrap.style.zIndex = "9998";
        wrap.style.background = "rgba(5, 10, 20, .42)";
        wrap.style.display = "flex";
        wrap.style.alignItems = "center";
        wrap.style.justifyContent = "center";
        wrap.style.padding = "24px";

        var panel = document.createElement("div");
        panel.style.width = "min(880px, 100%)";
        panel.style.maxHeight = "84vh";
        panel.style.display = "flex";
        panel.style.flexDirection = "column";
        panel.style.borderRadius = "10px";
        panel.style.background = "var(--card)";
        panel.style.color = "var(--ink)";
        panel.style.boxShadow = "var(--shadow-pop)";

        var head = document.createElement("div");
        head.style.display = "flex";
        head.style.alignItems = "center";
        head.style.gap = "12px";
        head.style.padding = "14px 16px";
        head.style.borderBottom = "1px solid var(--line)";

        var h = document.createElement("strong");
        h.textContent = "审阅 / 编辑方案 — 改对了再启动";
        h.style.flex = "1";

        var textarea = document.createElement("textarea");
        textarea.className = "plan-edit";
        textarea.value = typeof initialText === "string" ? initialText : "";
        textarea.style.boxSizing = "border-box";
        textarea.style.width = "100%";
        textarea.style.minHeight = "360px";
        textarea.style.resize = "vertical";
        textarea.style.border = "0";
        textarea.style.outline = "none";
        textarea.style.padding = "16px";
        textarea.style.font = "13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        textarea.style.color = "var(--ink)";

        var actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.justifyContent = "flex-end";
        actions.style.gap = "10px";
        actions.style.padding = "12px 16px";
        actions.style.borderTop = "1px solid var(--line)";

        var start = document.createElement("button");
        start.type = "button";
        start.textContent = "审阅后启动";
        start.style.border = "1px solid var(--primary)";
        start.style.background = "var(--primary)";
        start.style.color = "var(--card)";
        start.style.borderRadius = "6px";
        start.style.padding = "7px 12px";

        var cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "取消";
        cancel.style.border = "1px solid var(--line)";
        cancel.style.background = "var(--card)";
        cancel.style.color = "var(--ink)";
        cancel.style.borderRadius = "6px";
        cancel.style.padding = "7px 12px";

        function close(value) {
          if (done) return;
          done = true;
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
          resolve(value);
        }

        start.addEventListener("click", function () {
          var value = String(textarea.value || "").trim();
          if (!value) return;
          close(value);
        });
        cancel.addEventListener("click", function () {
          close(null);
        });
        wrap.addEventListener("click", function (event) {
          if (event.target === wrap) close(null);
        });

        head.appendChild(h);
        actions.appendChild(cancel);
        actions.appendChild(start);
        panel.appendChild(head);
        panel.appendChild(textarea);
        panel.appendChild(actions);
        wrap.appendChild(panel);
        document.body.appendChild(wrap);
        textarea.focus();
      } catch (_err) {
        resolve(null);
      }
    });
  }

  function actionElement(target) {
    if (!target) return null;
    if (target.closest) return target.closest("[data-action]");
    var node = target.parentElement;
    while (node) {
      if (node.matches && node.matches("[data-action]")) return node;
      node = node.parentElement;
    }
    return null;
  }

  function attr(el, name) {
    return el && el.getAttribute ? el.getAttribute(name) : null;
  }

  function nearestAttr(el, selector, name) {
    var parent = el && el.closest ? el.closest(selector) : null;
    return attr(parent, name);
  }

  function actionProject(el) {
    return attr(el, "data-project") || nearestAttr(el, "[data-project]", "data-project") || currentProjectId();
  }

  function proposalId(el) {
    return attr(el, "data-id") ||
      attr(el, "data-proposal") ||
      nearestAttr(el, "[data-proposal]", "data-proposal") ||
      attr(el, "data-flow") ||
      nearestAttr(el, "[data-flow]", "data-flow") ||
      "";
  }

  function flowId(el) {
    return attr(el, "data-flow") ||
      nearestAttr(el, "[data-flow-row]", "data-flow-row") ||
      nearestAttr(el, "[data-flow]", "data-flow") ||
      "";
  }

  async function postJson(url, payload, fallback, options) {
    var res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    var json = await res.json();
    toast(json.note || json.error || fallback);
    if (json && !json.error && !(options && options.skipRender)) await renderRoute();
    return json;
  }

  async function getJson(url) {
    var res = await fetch(url);
    return await res.json();
  }

`;
