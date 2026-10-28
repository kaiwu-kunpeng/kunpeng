export const part02: string = `  async function loadState() {
    try {
      var res = await fetch("/api/state");
      latestState = await res.json();
      updateStatusPill();
      return latestState;
    } catch (_err) {
      latestState = latestState || {};
      return latestState;
    }
  }

  async function pollPills() {
    if (document.hidden) return;
    try {
      var res = await fetch("/api/pills");
      var p = await res.json();
      renderStatusPill(p.running || 0, p.gates || 0);
    } catch (_e) {}
  }

  // 状态药丸(Dynamic Island):不开面板也跨路由可见——在跑 N / 待我处理 M。待我处理>0 时高亮可点→收件箱。
  function updateStatusPill() {
    var projects = (latestState && latestState.projects) || [];
    var running = 0, gates = 0;
    for (var i = 0; i < projects.length; i++) {
      var st = (projects[i] && projects[i].state) || {};
      if (Array.isArray(st.running)) running += st.running.length;
      if (Array.isArray(st.humanGates)) gates += st.humanGates.length;
    }
    renderStatusPill(running, gates);
  }

  function renderStatusPill(running, gates) {
    var pill = document.getElementById("kp-status-pill");
    if (!pill) return;
    if (running === 0 && gates === 0) { pill.style.display = "none"; return; }
    var parts = [];
    parts.push('<span style="display:inline-flex;align-items:center;gap:5px;color:var(--muted)"><span style="width:7px;height:7px;border-radius:50%;background:' + (running > 0 ? 'var(--info)' : 'var(--line)') + ';display:inline-block' + (running > 0 ? ';box-shadow:0 0 0 3px color-mix(in srgb,var(--info) 18%,transparent)' : '') + '"></span>在跑 ' + running + '</span>');
    if (gates > 0) {
      parts.push('<a href="#/inbox" data-pill-gates style="display:inline-flex;align-items:center;gap:5px;color:var(--warn);font-weight:700;text-decoration:none"><span style="width:7px;height:7px;border-radius:50%;background:var(--warn);display:inline-block;box-shadow:0 0 0 3px var(--warn-soft)"></span>待我处理 ' + gates + ' →</a>');
    }
    pill.innerHTML = parts.join('<span style="color:var(--line)">·</span>');
    pill.style.display = "inline-flex";
  }

  function setSidebarActive(route) {
    try {
      var links = document.querySelectorAll('a[href^="#/"]');
      var activeRoute = route === legacyReviewInboxRoute ? "#/inbox" : route;
      links.forEach(function (link) {
        var href = link.getAttribute("href") || "";
        var active = href === activeRoute;
        // 项目子路由 #/project/<id>/<tab> 时，项目基链接 #/project/<id> 仍应高亮（修原同义反复 no-op）。
        if (!active && href.indexOf("#/project/") === 0) {
          active = activeRoute === href || activeRoute.indexOf(href + "/") === 0;
        }
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
      var more = document.querySelector("details[data-nav-more], details.nav-more");
      if (more) {
        var moreRoutes = ["#/tasks", "#/register-project", "#/evolution", "#/architecture", "#/terminal", "#/switchboard", "#/settings"];
        more.open = moreRoutes.indexOf(activeRoute) >= 0;
      }
    } catch (_err) {
      return;
    }
  }

  function syncWorkspaceSwitcher(route) {
    try {
      var el = document.getElementById("kp-workspace-switcher");
      if (!el) return;
      // 跨项目视图(总览/任务台/待我处理/loops 等)一律显示「全部工作区」,只有 #/project/<id> 才选中具体项目;
      // 避免切到任务台等页面后开关停留在上一个项目的陈旧选中态(用户反馈「点了就没/对不上」)。
      var match = /^#\\/project\\/([^/]+)/.exec(route || "");
      el.value = match ? "#/project/" + match[1] : "#/overview";
    } catch (_err) {
      return;
    }
  }

  function bindWorkspaceSwitcher() {
    try {
      var el = document.getElementById("kp-workspace-switcher");
      if (!el) return;
      el.addEventListener("change", function () {
        window.location.hash = el.value || "#/overview";
      });
    } catch (_err) {
      return;
    }
  }

  async function renderView(route) {
    try {
      var selectedProduct = "";
      try { selectedProduct = localStorage.getItem("kpSelectedProduct") || ""; } catch (_e) { selectedProduct = ""; }
      var viewUrl = "/api/view?route=" + encodeURIComponent(route);
      if (selectedProduct) viewUrl += "&product=" + encodeURIComponent(selectedProduct);
      var res = await fetch(viewUrl);
      var html = await res.text();
      var view = document.getElementById("view");
      if (view) {
        view.innerHTML = html;
        kpInboxRestoreSelection();
        kpHydrateGateCommentCards(view);
      }
    } catch (_err) {
      return;
    }
  }

  function kpInboxIsRoute() {
    var route = currentRoute();
    return route === "#/inbox" || route === legacyReviewInboxRoute;
  }

  function kpInboxItems() {
    if (!kpInboxIsRoute()) return [];
    return Array.prototype.slice.call(document.querySelectorAll(".inbox-wrap [data-kp-inbox-item]"));
  }

  function kpInboxApplyOwnerFilter() {
    var value = "";
    try { value = localStorage.getItem("kp-inbox-owner") || ""; } catch (_e) { value = ""; }
    var select = document.querySelector("[data-kp-owner-filter]");
    if (select) {
      select.value = value;
      if (select.value !== value) value = "";
      if (!select.getAttribute("data-kp-bound")) {
        select.setAttribute("data-kp-bound", "1");
        select.addEventListener("change", function () {
          try { localStorage.setItem("kp-inbox-owner", select.value); } catch (_e) {}
          kpInboxApplyOwnerFilter();
        });
      }
    }
    document.querySelectorAll("[data-kp-inbox-item]").forEach(function (item) {
      item.hidden = !!(value && item.getAttribute("data-kp-owner") !== value);
    });
  }

  function kpInboxMarkVisibleSeen() {
    if (!kpInboxIsRoute()) return;
    kpInboxApplyOwnerFilter();
    var keys = Array.prototype.slice.call(document.querySelectorAll("[data-kp-inbox-id]")).map(function (item) {
      return item.getAttribute("data-kp-inbox-id") || "";
    }).filter(function (key, index, all) {
      return key.length > 0 && all.indexOf(key) === index;
    });
    if (!keys.length) return;
    try {
      fetch("/api/inbox/seen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: keys })
      }).catch(function () {});
    } catch (_err) {}
  }

  function kpInboxClearConfirmation() {
    if (!kpInboxConfirm) return;
    window.clearTimeout(kpInboxConfirm.timer);
    if (kpInboxConfirm.button && kpInboxConfirm.button.isConnected) {
      kpInboxConfirm.button.innerHTML = kpInboxConfirm.originalHtml;
    }
    kpInboxConfirm = null;
  }

  function kpInboxSelect(index, shouldScroll) {
    var items = kpInboxItems();
    if (!items.length) {
      kpInboxSelectedId = "";
      kpInboxSelectedIndex = -1;
      return null;
    }
    var bounded = Math.max(0, Math.min(index, items.length - 1));
    items.forEach(function (item, itemIndex) {
      var selected = itemIndex === bounded;
      item.classList.toggle("active", selected);
      if (selected) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    });
    var current = items[bounded];
    kpInboxSelectedId = current.getAttribute("data-kp-inbox-id") || "";
    kpInboxSelectedIndex = bounded;
    if (shouldScroll && current.scrollIntoView) current.scrollIntoView({ block: "nearest" });
    return current;
  }

  function kpInboxCurrentItem() {
    var items = kpInboxItems();
    if (!items.length) return null;
    var selectedIndex = items.findIndex(function (item) {
      return item.classList.contains("active");
    });
    if (selectedIndex >= 0) {
      kpInboxSelectedIndex = selectedIndex;
      kpInboxSelectedId = items[selectedIndex].getAttribute("data-kp-inbox-id") || "";
      return items[selectedIndex];
    }
    return kpInboxSelect(kpInboxSelectedIndex >= 0 ? kpInboxSelectedIndex : 0, false);
  }

  function kpInboxRestoreSelection() {
    if (!kpInboxIsRoute()) {
      kpInboxClearConfirmation();
      kpInboxCloseHelp();
      return;
    }
    var items = kpInboxItems();
    if (!items.length || (!kpInboxSelectedId && kpInboxSelectedIndex < 0)) return;
    var index = items.findIndex(function (item) {
      return item.getAttribute("data-kp-inbox-id") === kpInboxSelectedId;
    });
    kpInboxSelect(index >= 0 ? index : Math.min(kpInboxSelectedIndex, items.length - 1), false);
  }

  function kpInboxIsEditableTarget(target) {
    if (!target) return false;
    var tagName = String(target.tagName || "").toUpperCase();
    if (tagName === "INPUT" || tagName === "TEXTAREA") return true;
    if (target.isContentEditable) return true;
    return Boolean(target.closest && target.closest('[contenteditable="true"]'));
  }

  function kpInboxMove(delta) {
    var items = kpInboxItems();
    if (!items.length) return;
    kpInboxClearConfirmation();
    var index = items.findIndex(function (item) { return item.classList.contains("active"); });
    if (index < 0) index = delta > 0 ? -1 : items.length;
    kpInboxSelect(index + delta, true);
  }

  function kpInboxToggleDetail() {
    var item = kpInboxCurrentItem();
    if (!item) return;
    kpInboxClearConfirmation();
    var body = item.querySelector(".gate-b");
    if (body) {
      body.hidden = !body.hidden;
      if (!body.hidden) {
        var detail = item.querySelector('[data-kp-act="detail"]');
        if (detail) detail.click();
      }
      return;
    }
    var detailAction = item.querySelector('[data-kp-act="detail"]');
    if (detailAction) detailAction.click();
  }

  function kpInboxArmAction(kind, key) {
    var item = kpInboxCurrentItem();
    if (!item) return;
    var button = item.querySelector('[data-kp-act="' + kind + '"]');
    if (!button) return;
    var itemId = item.getAttribute("data-kp-inbox-id") || "";
    if (kpInboxConfirm && kpInboxConfirm.itemId === itemId && kpInboxConfirm.kind === kind) {
      var items = kpInboxItems();
      var index = items.indexOf(item);
      var next = index >= 0 && index + 1 < items.length ? items[index + 1] : null;
      kpInboxClearConfirmation();
      button.setAttribute("data-kp-armed", "1");
      try {
        button.click();
      } finally {
        button.removeAttribute("data-kp-armed");
      }
      if (next) kpInboxSelect(index + 1, true);
      else {
        item.classList.remove("active");
        item.removeAttribute("aria-current");
        kpInboxSelectedId = "";
        kpInboxSelectedIndex = -1;
      }
      return;
    }
    kpInboxClearConfirmation();
    var originalHtml = button.innerHTML;
    button.textContent = kind === "approve" ? "再按 a 确认" : kind === "defer" ? "再按 x 稍后处理" : "再按 d 确认驳回";
    var confirmation = {
      itemId: itemId,
      kind: kind,
      key: key,
      button: button,
      originalHtml: originalHtml,
      timer: 0
    };
    confirmation.timer = window.setTimeout(function () {
      if (kpInboxConfirm === confirmation) kpInboxClearConfirmation();
    }, 3000);
    kpInboxConfirm = confirmation;
  }

  function kpInboxCloseHelp() {
    if (!kpInboxHelpEl) return false;
    if (kpInboxHelpEl.parentNode) kpInboxHelpEl.parentNode.removeChild(kpInboxHelpEl);
    kpInboxHelpEl = null;
    return true;
  }

  function kpInboxToggleHelp() {
    if (kpInboxCloseHelp()) return;
    var dialog = document.createElement("dialog");
    dialog.className = "kp-inbox-help";
    dialog.setAttribute("aria-label", "收件箱快捷键");
    dialog.innerHTML = '<form method="dialog">'
      + '<div class="section-h"><h3>收件箱快捷键</h3></div>'
      + '<div class="runs">'
      + '<div class="run"><kbd>j / k</kbd><span>下一条 / 上一条</span></div>'
      + '<div class="run"><kbd>e</kbd><span>展开 / 收起详情</span></div>'
      + '<div class="run"><kbd>a / d</kbd><span>批准 / 驳回（再按一次确认）</span></div>'
      + '<div class="run"><kbd>? / ⌘/</kbd><span>打开 / 关闭快捷键速查</span></div>'
      + '</div><div class="acts"><button class="b gh" value="close">关闭</button></div></form>';
    dialog.addEventListener("close", function () { kpInboxCloseHelp(); });
    document.body.appendChild(dialog);
    kpInboxHelpEl = dialog;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function pushKeyBytes(value) {
    var padding = "=".repeat((4 - value.length % 4) % 4);
    var binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function setPushSettingState(enabled, message) {
    var toggle = document.querySelector("[data-push-toggle]");
    var status = document.querySelector("[data-push-status]");
    if (toggle) toggle.checked = enabled === true;
    if (status) status.textContent = message || "";
  }

  async function pushJson(url, value) {
    var response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value)
    });
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok || !payload || payload.ok !== true) {
      throw new Error((payload && payload.error) || "手机推送请求失败");
    }
    return payload;
  }

  async function setPushEnabled(enabled) {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      throw new Error("当前浏览器不支持 Web Push");
    }
    if (enabled) {
      var permission = window.Notification.permission;
      if (permission !== "granted") permission = await window.Notification.requestPermission();
      if (permission !== "granted") throw new Error("通知权限未授予");
    }
    var registration = await navigator.serviceWorker.ready;
    var subscription = await registration.pushManager.getSubscription();
    if (!enabled) {
      if (subscription) {
        var endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await pushJson("/api/push/unsubscribe", { endpoint: endpoint });
      }
      setPushSettingState(false, "已关闭");
      return;
    }
    var created = false;
    if (!subscription) {
      var keyResponse = await fetch("/api/push/vapid-key");
      var keyPayload = await keyResponse.json().catch(function () { return {}; });
      if (!keyResponse.ok || !keyPayload.publicKey) throw new Error(keyPayload.error || "VAPID 公钥读取失败");
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: pushKeyBytes(keyPayload.publicKey)
      });
      created = true;
    }
    try {
      await pushJson("/api/push/subscribe", subscription.toJSON ? subscription.toJSON() : subscription);
    } catch (error) {
      if (created) await subscription.unsubscribe().catch(function () {});
      throw error;
    }
    setPushSettingState(true, "已开启:任务跑完/出错/待审门会推送到本机");
  }

  async function initPushSetting() {
    var existing = document.querySelector("[data-push-setting]");
    if (!existing) {
      var notifyInput = document.querySelector("[data-nf]");
      var host = notifyInput && notifyInput.closest ? notifyInput.closest(".acc-body") : null;
      if (!host) return;
      var row = document.createElement("div");
      row.className = "run";
      row.setAttribute("data-push-setting", "true");
      row.innerHTML = '<span class="tag">📳 手机推送</span>'
        + '<label><input type="checkbox" data-push-toggle> 开启</label>'
        + '<span class="hint" data-push-status>检查中…</span>';
      host.appendChild(row);
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPushSettingState(false, "当前浏览器不支持 Web Push");
      var unsupported = document.querySelector("[data-push-toggle]");
      if (unsupported) unsupported.disabled = true;
      return;
    }
    try {
      var registration = await navigator.serviceWorker.ready;
      var subscription = await registration.pushManager.getSubscription();
      setPushSettingState(Boolean(subscription), subscription
        ? "已开启:任务跑完/出错/待审门会推送到本机"
        : "未开启");
    } catch (_error) {
      setPushSettingState(false, "推送状态读取失败");
    }
  }

  function libraryApplyFilters() {
    var grid = document.querySelector("[data-lib-grid]");
    if (!grid) return;
    var input = document.querySelector("[data-lib-search]");
    var query = String(input && input.value ? input.value : "").trim().toLowerCase();
    var kind = grid.getAttribute("data-lib-active-type") || "all";
    var items = document.querySelectorAll("[data-lib-item]");
    var visibleCount = 0;
    items.forEach(function (item) {
      var kindMatches = kind === "all" || item.getAttribute("data-lib-kind") === kind;
      var textMatches = !query || String(item.getAttribute("data-lib-text") || "").toLowerCase().indexOf(query) >= 0;
      var visible = kindMatches && textMatches;
      item.style.display = visible ? "" : "none";
      if (visible) visibleCount += 1;
    });
    var empty = document.querySelector("[data-lib-empty]");
    if (empty) empty.hidden = visibleCount > 0;
  }

  function bindLibraryFilters() {
    var grid = document.querySelector("[data-lib-grid]");
    var input = document.querySelector("[data-lib-search]");
    if (!grid || !input) return;
    input.addEventListener("input", libraryApplyFilters);
    document.querySelectorAll("[data-lib-type]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var selected = chip.getAttribute("data-lib-type") || "all";
        grid.setAttribute("data-lib-active-type", selected);
        document.querySelectorAll("[data-lib-type]").forEach(function (candidate) {
          var active = candidate === chip;
          candidate.classList.toggle("pri", active);
          candidate.setAttribute("aria-pressed", active ? "true" : "false");
        });
        libraryApplyFilters();
      });
    });
  }

  function libraryCaptureCard(entry) {
    var title = entry && entry.title ? String(entry.title) : "未命名知识";
    var tags = entry && Array.isArray(entry.tags) ? entry.tags.join(" ") : "";
    var detail = entry && (entry.project || entry.sourcePath) ? String(entry.project || entry.sourcePath) : tags;
    var text = (title + " " + detail + " " + tags).toLowerCase();
    return '<div class="ops-card" data-lib-item data-lib-kind="capture" data-lib-text="' + escHtml(text) + '">' +
      '<div class="ops-card-title">' + escHtml(title) + '</div>' +
      '<div class="hint"><span class="tag">知识</span> ' + escHtml(detail) + '</div>' +
      '</div>';
  }

  async function libraryLoad() {
    var box = document.querySelector("[data-lib-captures]");
    if (!box) return;
    bindLibraryFilters();
    try {
      var res = await fetch("/api/library?type=capture");
      var data = await res.json();
      if (!res.ok || !data || data.ok !== true || !Array.isArray(data.entries)) throw new Error("library unavailable");
      box.innerHTML = data.entries.map(libraryCaptureCard).join("");
    } catch (_err) {
      box.innerHTML = '<div class="hint"><a href="#/knowledge">知识索引未建,去知识工作台</a></div>';
    }
    libraryApplyFilters();
  }

  async function initDesignPresets() {
    var select = document.querySelector("[data-design-preset]");
    if (!select) return;
    try {
      var res = await fetch("/api/design-presets?projectId=" + encodeURIComponent(currentProjectId()));
      var data = await res.json();
      if (!data || data.ok !== true || !Array.isArray(data.presets)) return;
      var current = select.value || "";
      var options = ['<option value="">预设（可选，150 套）</option>'];
      data.presets.forEach(function (preset) {
        if (!preset || !preset.id) return;
        var id = String(preset.id);
        var name = String(preset.name || id);
        var category = preset.category ? String(preset.category) : "";
        var label = category ? name + " · " + category : name;
        options.push('<option value="' + escHtml(id) + '">' + escHtml(label) + '</option>');
      });
      select.innerHTML = options.join("");
      if (current) select.value = current;
    } catch (_err) {}
  }

  function todayBucketHtml(label, items, count) {
    var statusLabels = { "draft": "草稿", "ready": "就绪", "running": "在跑", "verifying": "验证", "needs-review": "待审", "delivered": "交付", "blocked": "阻塞", "archived": "归档", "unknown": "未知" };
    var rows = ['<div class="run"><span class="tag">' + escHtml(label + " " + count) + '</span></div>'];
    items.forEach(function (task) {
      var name = task && (task.title || task.id) ? (task.title || task.id) : "未命名任务";
      var status = task && task.status ? task.status : "unknown";
      var buttons = "";
      if (task && task.source === "store" && Array.isArray(task.nextStatuses) && task.nextStatuses.length > 0) {
        buttons = '<span style="display:inline-flex;gap:6px;margin-left:auto;flex-wrap:wrap">' + task.nextStatuses.map(function (to) {
          return '<button class="b" data-action="task-transition" data-id="' + escHtml(task.id) + '" data-to="' + escHtml(to) + '">' + escHtml(statusLabels[to] || to) + '</button>';
        }).join("") + '</span>';
      }
      rows.push('<div class="run"><span class="name">' + escHtml(name) + '</span><span class="stage">' + escHtml(statusLabels[status] || status) + '</span>' + buttons + '</div>');
      if (task && task.source === "store" && Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0) {
        var firstCriterion = String(task.acceptanceCriteria[0] || "");
        var clippedCriterion = firstCriterion.length > 60 ? firstCriterion.slice(0, 57) + "..." : firstCriterion;
        var suffix = task.acceptanceCriteria.length > 1 ? " 等" + task.acceptanceCriteria.length + "条" : "";
        rows.push('<div class="run"><span class="name" style="color:var(--muted)">验收: ' + escHtml(clippedCriterion + suffix) + '</span></div>');
      }
    });
    return rows.join("");
  }

  async function loadTodaySection() {
    var box = document.querySelector("[data-today-summary]");
    if (!box) return;
    box.innerHTML = '<div class="run empty"><span class="name">加载中…</span></div>';
    try {
      var res = await fetch("/api/today?projectId=" + encodeURIComponent(currentProjectId()));
      var data = await res.json();
      if (!res.ok || !data) {
        box.innerHTML = '<div class="run empty"><span class="name">今日读取失败：' + escHtml((data && (data.error || data.problems && data.problems.join("；"))) || "未知错误") + '</span></div>';
        return;
      }
      var ready = Array.isArray(data.ready) ? data.ready : [];
      var needsReview = Array.isArray(data.needsReview) ? data.needsReview : [];
      var running = Array.isArray(data.running) ? data.running : [];
      var blocked = Array.isArray(data.blocked) ? data.blocked : [];
      var delivered = Array.isArray(data.delivered) ? data.delivered : [];
      var counts = data.counts || {};
      var total = ready.length + needsReview.length + running.length + blocked.length + delivered.length;
      if (total === 0) {
        box.innerHTML = '<div class="run empty"><span class="name">今日无事，去创建一个任务</span></div>';
        return;
      }
      box.innerHTML =
        todayBucketHtml("就绪", ready, counts.ready != null ? counts.ready : ready.length) +
        todayBucketHtml("待审批", needsReview, counts.needsReview != null ? counts.needsReview : needsReview.length) +
        todayBucketHtml("在跑", running, counts.running != null ? counts.running : running.length) +
        todayBucketHtml("阻塞", blocked, counts.blocked != null ? counts.blocked : blocked.length) +
        todayBucketHtml("24h 交付", delivered, counts.delivered != null ? counts.delivered : delivered.length);
    } catch (_err) {
      box.innerHTML = '<div class="run empty"><span class="name">今日读取失败：网络或服务错误</span></div>';
    }
  }

  function taskBoardOwner() {
    var user = document.querySelector(".kp-user");
    var username = user ? String(user.textContent || "").replace(/^\\s*👤\\s*/, "").trim() : "";
    return username || "me";
  }

  function taskBoardSetMessage(message, isError) {
    var box = document.querySelector("[data-taskboard-message]");
    if (!box) return;
    box.textContent = "";
    if (!message) return;
    var row = document.createElement("div");
    row.className = "run empty";
    var text = document.createElement("span");
    text.className = isError ? "name tag-danger" : "name";
    text.textContent = String(message);
    row.appendChild(text);
    box.appendChild(row);
  }

  function taskBoardRowHtml(task) {
    var id = escHtml(task && task.id);
    var subject = escHtml(task && task.subject);
    var rawStatus = task && task.status ? String(task.status) : "";
    var statusLabels = { "pending": "待认领", "in_progress": "进行中", "completed": "已完成", "deleted": "已删除" };
    var status = escHtml(rawStatus);
    var statusLabel = escHtml(statusLabels[rawStatus] || rawStatus);
    var owner = escHtml(task && task.owner ? task.owner : "—");
    var blocked = task && Array.isArray(task.blockedBy) && task.blockedBy.length > 0
      ? '<span class="tag tag-warn">🔒 阻塞</span>'
      : "";
    var action = "";
    if (task && task.status === "pending") {
      action = '<button class="b" type="button" data-taskboard-claim="' + id + '">认领</button>';
    } else if (task && task.status === "in_progress") {
      action = '<button class="b" type="button" data-taskboard-complete="' + id + '">完成</button>';
    }
    return '<div class="run" data-taskboard-task="' + id + '">'
      + '<span class="name">#' + id + ' ' + subject + '</span>'
      + '<span class="stage" title="' + status + '">' + statusLabel + '</span>'
      + '<span class="hint">负责人 ' + owner + '</span>'
      + blocked + action + '</div>';
  }

  async function loadTaskBoard() {
    var list = document.querySelector("[data-taskboard-list]");
    if (!list) return;
    list.innerHTML = '<div class="run empty"><span class="name">加载中…</span></div>';
    try {
      var response = await fetch("/api/taskboard");
      var payload = await response.json();
      if (response.ok === false || !payload || payload.error) {
        throw new Error(payload && payload.error ? payload.error : "协作队列读取失败");
      }
      var tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      list.innerHTML = tasks.length > 0
        ? tasks.map(taskBoardRowHtml).join("")
        : '<div class="run empty"><span class="name">暂无协作任务</span></div>';
    } catch (error) {
      list.innerHTML = '<div class="run empty"><span class="name">协作队列读取失败：' + escHtml(error && error.message ? error.message : String(error)) + '</span></div>';
    }
  }

  async function taskBoardRequest(url, payload) {
    var response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    var result = await response.json().catch(function () { return {}; });
    if (response.ok === false || !result || result.ok === false || result.error) {
      throw new Error(result && result.error ? result.error : "操作失败");
    }
    return result;
  }

  async function taskBoardMutate(button, url, payload, successMessage) {
    if (button) button.disabled = true;
    var succeeded = false;
    try {
      var result = await taskBoardRequest(url, payload);
      succeeded = true;
      taskBoardSetMessage(typeof successMessage === "function" ? successMessage(result) : successMessage, false);
    } catch (error) {
      taskBoardSetMessage(error && error.message ? error.message : String(error), true);
    } finally {
      await loadTaskBoard();
      if (button && button.isConnected) button.disabled = false;
    }
    return succeeded;
  }

`;
