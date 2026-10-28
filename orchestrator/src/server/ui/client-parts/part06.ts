export const part06: string = `  function kpGateCommentRow(comment) {
    var row = document.createElement("div");
    row.className = "kp-gc-comment";
    row.textContent = String(comment && comment.text ? comment.text : "");
    return row;
  }

  function kpGateCommentSection(card, file) {
    var sections = card.querySelectorAll("[data-kp-gc-section]");
    for (var i = 0; i < sections.length; i += 1) {
      if ((sections[i].getAttribute("data-kp-gc-file-scope") || "") === file) return sections[i];
    }
    return null;
  }

  function kpGateCommentCount(card) {
    var count = card.querySelectorAll(".kp-gc-comment").length;
    var label = card.querySelector("[data-kp-gc-count]");
    if (label) label.textContent = String(count) + " 条评论";
  }

  function kpRenderGateComments(card, comments) {
    card.querySelectorAll("[data-kp-gc-comments]").forEach(function (box) {
      box.textContent = "";
    });
    (Array.isArray(comments) ? comments : []).forEach(function (comment) {
      var section = kpGateCommentSection(card, String(comment && comment.file ? comment.file : ""));
      var box = section && section.querySelector("[data-kp-gc-comments]");
      if (box) box.appendChild(kpGateCommentRow(comment));
    });
    kpGateCommentCount(card);
  }

  async function kpHydrateGateCommentCard(card) {
    if (!card || card.getAttribute("data-kp-gc-loading") === "1" || card.getAttribute("data-kp-gc-loaded") === "1") return;
    var planId = card.getAttribute("data-flow") || "";
    if (!planId) return;
    card.setAttribute("data-kp-gc-loading", "1");
    try {
      var payload = await getJson("/api/gate-comments?planId=" + encodeURIComponent(planId));
      if (!payload || payload.ok !== true) throw new Error(payload && payload.error ? payload.error : "评论读取失败");
      kpRenderGateComments(card, payload.comments);
      card.setAttribute("data-kp-gc-loaded", "1");
    } catch (error) {
      var count = card.querySelector("[data-kp-gc-count]");
      if (count) count.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      card.removeAttribute("data-kp-gc-loading");
    }
  }

  function kpHydrateGateCommentCards(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll(".kp-diff-card[data-flow]").forEach(function (card) {
      kpHydrateGateCommentCard(card).catch(function () {});
    });
  }

  function kpGateCommentError(host, message, attribute) {
    var error = host.querySelector("[" + attribute + "]");
    if (!error) {
      error = document.createElement("span");
      error.setAttribute(attribute, "");
      error.className = "kp-gc-error";
      host.appendChild(error);
    }
    error.textContent = String(message || "操作失败");
  }

  function kpGateDiffSections(diff) {
    var lines = String(diff || "").split("\\n");
    var sections = [];
    var current = [];
    lines.forEach(function (line) {
      if (line.indexOf("diff --git ") === 0 && current.length) {
        sections.push(current.join("\\n"));
        current = [];
      }
      current.push(line);
    });
    if (current.length) sections.push(current.join("\\n"));
    return sections;
  }

  function kpGateDiffFile(section) {
    var lines = String(section || "").split("\\n");
    for (var i = 0; i < lines.length; i += 1) {
      if (lines[i].indexOf("+++ b/") === 0) return lines[i].slice(6);
    }
    var header = lines[0] || "";
    var marker = header.lastIndexOf(" b/");
    return marker >= 0 ? header.slice(marker + 3) : "(diff)";
  }

  function kpGateDiffCardHtml(planId, diff) {
    var safePlanId = escHtml(planId);
    var sections = kpGateDiffSections(diff).map(function (section) {
      var file = kpGateDiffFile(section);
      var safeFile = escHtml(file);
      return '<section class="kp-diff-file" data-kp-gc-section data-kp-gc-file-scope="' + safeFile + '">'
        + '<div class="kp-diff-file-head"><span>' + safeFile + '</span>'
        + '<button type="button" data-kp-gc-file="' + safeFile + '">💬 留言</button></div>'
        + '<div class="kp-gc-editor" data-kp-gc-editor hidden></div>'
        + '<div class="kp-gc-comments" data-kp-gc-comments></div>'
        + '<pre class="kp-diff-body">' + escHtml(section) + '</pre></section>';
    }).join("");
    return '<div class="kp-diff-card" data-flow="' + safePlanId + '">'
      + '<div class="kp-diff-head">' + safePlanId + '</div>'
      + '<div class="kp-diff-files">' + sections + '</div>'
      + '<div class="kp-diff-actions">'
      + '<button type="button" data-kp-gc-sendback="' + safePlanId + '">↩ 发回重改</button>'
      + '<span data-kp-gc-count>0 条评论</span></div></div>';
  }

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target : null;
    if (!target) return;
    var open = target.closest("[data-kp-gc-file]");
    if (open) {
      event.preventDefault();
      var section = open.closest("[data-kp-gc-section]");
      var editor = section && section.querySelector("[data-kp-gc-editor]");
      if (!section || !editor) return;
      if (!editor.querySelector("textarea")) {
        var textarea = document.createElement("textarea");
        textarea.setAttribute("aria-label", "评审评论");
        textarea.placeholder = "写下要改什么";
        var submit = document.createElement("button");
        submit.type = "button";
        submit.setAttribute("data-kp-gc-submit", "");
        submit.textContent = "提交评论";
        editor.appendChild(textarea);
        editor.appendChild(submit);
      }
      editor.hidden = !editor.hidden;
      if (!editor.hidden) editor.querySelector("textarea").focus();
      return;
    }

    var submitComment = target.closest("[data-kp-gc-submit]");
    if (submitComment) {
      event.preventDefault();
      var submitSection = submitComment.closest("[data-kp-gc-section]");
      var submitCard = submitComment.closest(".kp-diff-card[data-flow]");
      var submitEditor = submitComment.closest("[data-kp-gc-editor]");
      var submitTextarea = submitEditor && submitEditor.querySelector("textarea");
      var text = submitTextarea && submitTextarea.value ? String(submitTextarea.value).trim() : "";
      if (!submitSection || !submitCard || !submitEditor || !text) {
        if (submitEditor) kpGateCommentError(submitEditor, "评论不能为空", "data-kp-gc-error");
        return;
      }
      submitComment.disabled = true;
      fetch("/api/gate-comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId: submitCard.getAttribute("data-flow") || "",
          file: submitSection.getAttribute("data-kp-gc-file-scope") || "",
          text: text
        })
      }).then(function (response) {
        return response.json();
      }).then(function (payload) {
        if (!payload || payload.ok !== true) throw new Error(payload && payload.error ? payload.error : "评论提交失败");
        var box = submitSection.querySelector("[data-kp-gc-comments]");
        if (box) box.appendChild(kpGateCommentRow(payload.comment || { text: text }));
        submitTextarea.value = "";
        submitEditor.hidden = true;
        var oldError = submitEditor.querySelector("[data-kp-gc-error]");
        if (oldError) oldError.remove();
        kpGateCommentCount(submitCard);
      }).catch(function (error) {
        kpGateCommentError(submitEditor, error instanceof Error ? error.message : String(error), "data-kp-gc-error");
      }).finally(function () {
        submitComment.disabled = false;
      });
      return;
    }

    var sendback = target.closest("[data-kp-gc-sendback]");
    if (!sendback) return;
    event.preventDefault();
    var sendbackCard = sendback.closest(".kp-diff-card[data-flow]");
    var sendbackActions = sendback.closest(".kp-diff-actions") || sendbackCard;
    var sendbackPlanId = sendback.getAttribute("data-kp-gc-sendback") || "";
    if (!sendbackCard || !sendbackPlanId || !window.confirm("确认发回重改 " + sendbackPlanId + "？")) return;
    sendback.disabled = true;
    fetch("/api/gate-comments/sendback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId: sendbackPlanId })
    }).then(function (response) {
      return response.json();
    }).then(function (payload) {
      if (!payload || payload.ok !== true || payload.launched !== true) {
        throw new Error(payload && payload.error ? payload.error : "发回失败");
      }
      sendback.textContent = "已发回,重改流已起 ✓";
      var oldError = sendbackActions && sendbackActions.querySelector("[data-kp-gc-sendback-error]");
      if (oldError) oldError.remove();
    }).catch(function (error) {
      sendback.disabled = false;
      if (sendbackActions) kpGateCommentError(sendbackActions, error instanceof Error ? error.message : String(error), "data-kp-gc-sendback-error");
    });
  });

  async function opsTimelineLoad() {
    var box = document.querySelector("[data-ops-timeline]");
    if (!box) return;
    try {
      var data = await getJson("/api/ops/actions?days=30");
      var actions = data && Array.isArray(data.actions) ? data.actions : [];
      if (!actions.length) {
        box.innerHTML = '<div class="run empty"><span class="name">还没有动作记录,跑一波运营循环后回来看</span></div>';
        return;
      }
      box.innerHTML = actions.map(function (action) {
        var after = Number(action && action.metricAfter);
        var delta = Number(action && action.metricDelta);
        var before = after - delta;
        var deltaText = delta >= 0 ? "+" + delta : String(delta);
        var verifiedClass = action && action.verified ? "verify" : "impl";
        var verifiedText = action && action.verified ? "verified" : "unverified";
        var date = new Date(Number(action && action.at)).toLocaleString();
        return '<div class="run">'
          + '<span class="muted">' + escHtml(date) + '</span>'
          + '<span class="tag">loop ' + escHtml(action && action.loopId) + '</span>'
          + '<span class="name">' + escHtml(action && action.lever) + '</span>'
          + '<span class="tag">' + escHtml(before) + '→' + escHtml(after) + '</span>'
          + '<span class="stage impl">' + escHtml("Δ " + deltaText) + '</span>'
          + '<span class="stage ' + verifiedClass + '">' + verifiedText + '</span>'
          + '</div>';
      }).join("");
    } catch (_err) {}
  }

  // 设置页「账号」分组：异步拉取并渲染 Web 用户列表（owner 才有权限，否则后端 403）。
  async function loadAccounts() {
    var box = document.getElementById("acctList");
    if (!box) return;
    try {
      var j = await getJson("/api/accounts");
      if (!j || !j.ok || !Array.isArray(j.accounts)) {
        box.innerHTML = '<div class="run"><span class="name muted">需要 owner 权限才能管理账号</span></div>';
        return;
      }
      if (!j.accounts.length) {
        box.innerHTML = '<div class="run"><span class="name muted">暂无账号</span></div>';
        return;
      }
      box.innerHTML = j.accounts.map(function (a) {
        var u = escHtml(a.username), r = escHtml(a.role), p = escHtml(a.profileId);
        return '<div class="run">'
          + '<span class="tag">' + u + '</span>'
          + '<span class="name">' + r + ' · ' + p + '</span>'
          + '<button class="b" data-action="edit-account" data-username="' + u + '" data-role="' + r + '" data-profile="' + p + '" style="margin-left:auto">改</button>'
          + '<button class="b" data-action="delete-account" data-username="' + u + '">删除</button>'
          + '</div>';
      }).join("");
    } catch (_e) {
      box.innerHTML = '<div class="run"><span class="name muted">账号列表加载失败</span></div>';
    }
  }

  function knowledgeEmpty(text) {
    return '<div class="run empty"><span class="name">' + escHtml(text) + '</span></div>';
  }

  function knowledgePromoteButton(id) {
    return '<button class="b pri" data-action="knowledge-promote" data-id="' + escHtml(id) + '">采纳</button>';
  }

  function knowledgeCaptureRow(capture) {
    var id = capture && capture.id != null ? String(capture.id) : "";
    var title = capture && capture.title ? String(capture.title) : "";
    var summary = capture && capture.summary ? String(capture.summary) : "";
    var head = title || summary || "(无摘要)";
    var url = capture && capture.citedFrom ? String(capture.citedFrom) : "";
    var cat = capture && capture.category ? capture.category : "";
    var tags = capture && Array.isArray(capture.tags) ? capture.tags.map(function (tag) { return String(tag); }) : [];
    var action = capture && capture.promoted === true
      ? '<span class="stage verify">✓ 已采纳</span>'
      : knowledgePromoteButton(id);
    return '<div class="run" data-capture="' + escHtml(id) + '" data-title="' + escHtml(title) + '" data-tags="' + escHtml(tags.join(", ")) + '">' +
      '<span class="name">' + escHtml(head) + '</span>' +
      (title && summary ? '<span class="muted">' + escHtml(summary) + '</span>' : '') +
      (cat ? '<span class="tag" style="background:var(--primary-soft);color:var(--primary);border-color:var(--primary-line)">' + escHtml(cat) + '</span>' : '') +
      (url ? '<a class="muted" href="' + escHtml(url) + '" target="_blank" rel="noopener">打开原文 ↗</a>' : '') +
      (capture && capture.distill ? '<span class="muted" style="white-space:pre-wrap">' + escHtml(capture.distill) + '</span>' : '') +
      '<button class="b" data-action="knowledge-distill-card" data-id="' + escHtml(id) + '">深读' + (capture && capture.distillLevel ? ' L' + escHtml(capture.distillLevel) : '') + '</button>' +
      '<button class="b" data-action="knowledge-edit" data-id="' + escHtml(id) + '">编辑</button>' +
      '<button class="b warn" data-action="knowledge-delete" data-id="' + escHtml(id) + '" data-armed="0">删除</button>' +
      action +
      '</div>';
  }

  function knowledgeHitRow(hit) {
    var capture = hit && hit.capture ? hit.capture : {};
    var citation = hit && hit.citation ? hit.citation : {};
    var id = capture && capture.id != null ? String(capture.id) : "";
    var terms = Array.isArray(citation.matchedTerms) ? citation.matchedTerms.join(" · ") : "";
    var url = capture && capture.citedFrom ? String(capture.citedFrom) : "";
    var action = capture && capture.promoted === true
      ? '<span class="stage verify">✓ 已采纳</span>'
      : knowledgePromoteButton(id);
    return '<div class="run" data-capture="' + escHtml(id) + '">' +
      '<span class="tag">' + escHtml(id) + '</span>' +
      '<span class="name">' + escHtml(citation.snippet) + '</span>' +
      '<span class="muted">' + escHtml(citation.source) + '</span>' +
      (capture && capture.category ? '<span class="tag" style="background:var(--primary-soft);color:var(--primary);border-color:var(--primary-line)">' + escHtml(capture.category) + '</span>' : '') +
      (url ? '<a class="muted" href="' + escHtml(url) + '" target="_blank" rel="noopener">打开原文 ↗</a>' : '') +
      '<span class="muted">' + escHtml(terms) + '</span>' +
      action +
      '</div>';
  }

  function knowledgeGroupBlock(title, hint, items, rowFn) {
    if (!items.length) return "";
    return '<div class="section-h"><h3>' + escHtml(title) + '</h3>' +
      '<span class="hint">' + escHtml(hint + " · " + items.length) + '</span></div>' +
      items.map(rowFn).join("");
  }

  // 知识卡片分栏:外部抓取(source==="url") 与 我们自己沉淀(text/file) 分开呈现,不堆在一起。
  function renderKnowledgeSections(items, rowFn, getCapture) {
    var external = [], internal = [];
    for (var i = 0; i < items.length; i++) {
      var cap = getCapture(items[i]);
      if (cap && cap.source === "url") external.push(items[i]);
      else internal.push(items[i]);
    }
    var html = knowledgeGroupBlock("外部知识", "抓取的外部链接", external, rowFn) +
      knowledgeGroupBlock("我们的总结", "自己沉淀的笔记", internal, rowFn);
    return html || knowledgeEmpty("暂无知识卡片");
  }

  function renderKnowledgeRows(data) {
    if (data && Array.isArray(data.hits)) {
      if (data.hits.length === 0) return knowledgeEmpty("无匹配");
      return renderKnowledgeSections(data.hits, knowledgeHitRow, function (h) { return h && h.capture ? h.capture : null; });
    }
    if (data && Array.isArray(data.captures)) {
      if (data.captures.length === 0) return knowledgeEmpty("暂无知识卡片");
      return renderKnowledgeSections(data.captures, knowledgeCaptureRow, function (c) { return c; });
    }
    return knowledgeEmpty("暂无知识卡片");
  }

  async function knowledgeLoad(q) {
    var query = String(q == null ? "" : q).trim();
    var projectId = currentProjectId();
    var data = await getJson("/api/knowledge-search?projectId=" + encodeURIComponent(projectId) + "&q=" + encodeURIComponent(query));
    var box = document.getElementById("knowledge-results");
    if (box) box.innerHTML = renderKnowledgeRows(data);
    return data;
  }

  async function resurfaceLoad() {
    var box = document.getElementById("knowledge-resurface");
    if (!box) return null;
    try {
      var projectId = currentProjectId();
      var data = await getJson("/api/knowledge-resurface?projectId=" + encodeURIComponent(projectId));
      var captures = data && Array.isArray(data.captures) ? data.captures : [];
      box.innerHTML = captures.length === 0
        ? knowledgeEmpty("暂无可温故的卡片")
        : captures.map(knowledgeCaptureRow).join("");
      return data;
    } catch (_err) {
      box.innerHTML = knowledgeEmpty("暂无可温故的卡片");
      return null;
    }
  }

  async function tagcloudLoad() {
    var box = document.getElementById("knowledge-tagcloud");
    if (!box) return null;
    try {
      var projectId = currentProjectId();
      var data = await getJson("/api/knowledge-tagcloud?projectId=" + encodeURIComponent(projectId));
      var tags = data && Array.isArray(data.tags) ? data.tags : [];
      if (tags.length === 0) {
        box.innerHTML = '<div class="run empty"><span class="name">暂无标签</span></div>';
        return data;
      }
      box.innerHTML = '<div class="run" style="flex-wrap:wrap;display:flex;gap:4px 12px;align-items:baseline">' +
        tags.map(function (t) {
          return '<a data-action="knowledge-tag" data-tag="' + escHtml(t.tag) + '" style="font-size:' + (KW_SIZES[t.level]||16) + 'px;color:' + kwColor(t.category, t.tag) + ';line-height:1.9;text-decoration:none;cursor:pointer" title="' + escHtml(t.tag) + ' · ' + escHtml(t.count) + '">' + escHtml(t.tag) + '<sup style="font-size:10px;opacity:.5">' + escHtml(t.count) + '</sup></a>';
        }).join("") +
        '</div>';
      return data;
    } catch (_err) {
      box.innerHTML = '<div class="run empty"><span class="name">暂无标签</span></div>';
      return null;
    }
  }

  function sbReasonLabel(reason) {
    if (reason === "recipient-offline") return "收件人不在线";
    if (reason === "stale-unread") return "超时未读";
    return String(reason || "");
  }

  function sbMsgRow(m, opts) {
    var urgent = m && m.urgent === true;
    var dot = urgent ? '<span class="dot dot-danger" style="margin:0 8px 0 0;position:static"></span>' : '';
    var topic = m && m.topic ? '<span class="tag">' + escHtml(m.topic) + '</span>' : '';
    var route = (m && m.from ? escHtml(m.from) : "?") + " → " + (m && m.to ? escHtml(m.to) : "?");
    var body = m && m.body ? escHtml(m.body) : "";
    var rsn = opts && opts.reason ? '<span class="stage impl">' + escHtml(sbReasonLabel(opts.reason)) + '</span>' : '';
    return '<div class="run' + (urgent ? ' sb-urgent' : '') + '">' +
      dot + topic +
      '<span class="name">' + body + '</span>' +
      '<span class="muted" style="margin-left:8px">' + route + '</span>' + rsn +
      '</div>';
  }

  async function switchboardLoad() {
    // 1) 救命优先:没人接的紧急消息
    var escBox = document.getElementById("sb-escalations");
    if (escBox) {
      try {
        var esc = await getJson("/api/switchboard/escalations");
        var list = esc && Array.isArray(esc.escalations) ? esc.escalations : [];
        if (list.length === 0) {
          escBox.innerHTML = '<div class="sb-ok"><span class="dot dot-success" style="position:static;margin-right:8px"></span>无待升级 · 紧急消息都有人接</div>';
        } else {
          escBox.innerHTML = '<div class="sb-alert">' +
            '<div class="sb-alert-h"><span class="dot dot-danger" style="position:static;margin-right:8px"></span>' +
            list.length + ' 条紧急没人收，需人类介入</div>' +
            list.map(function (e) { return sbMsgRow(e && e.message, { reason: e && e.reason }); }).join("") +
            '</div>';
        }
      } catch (_e) {
        escBox.innerHTML = '<div class="run empty"><span class="name">升级队列读取失败</span></div>';
      }
    }
    // 2) 在线实例
    var presBox = document.getElementById("sb-presence");
    if (presBox) {
      try {
        var pres = await getJson("/api/switchboard/presence");
        var online = pres && Array.isArray(pres.online) ? pres.online : [];
        presBox.innerHTML = online.length === 0
          ? '<div class="run empty"><span class="name">当前无在线实例</span></div>'
          : '<div class="run" style="flex-wrap:wrap;gap:8px">' +
              online.map(function (n) { return '<span class="tag"><span class="dot dot-success" style="position:static;margin-right:6px;display:inline-block;vertical-align:middle"></span>' + escHtml(n) + '</span>'; }).join("") +
              '</div>';
      } catch (_e2) {
        presBox.innerHTML = '<div class="run empty"><span class="name">在线状态读取失败</span></div>';
      }
    }
    // 3) 消息流(紧急置顶);进入即标记已读
    var inboxBox = document.getElementById("sb-inbox");
    if (inboxBox) {
      try {
        var inb = await getJson("/api/switchboard/inbox?as=" + encodeURIComponent(SB_AS));
        var msgs = inb && Array.isArray(inb.messages) ? inb.messages.slice() : [];
        msgs.sort(function (a, b) {
          var au = a && a.urgent === true ? 1 : 0, bu = b && b.urgent === true ? 1 : 0;
          if (au !== bu) return bu - au;
          return (b && b.ts ? b.ts : 0) - (a && a.ts ? a.ts : 0);
        });
        inboxBox.innerHTML = msgs.length === 0
          ? '<div class="run empty"><span class="name">收件箱为空</span></div>'
          : msgs.map(function (m) { return sbMsgRow(m, null); }).join("");
      } catch (_e3) {
        inboxBox.innerHTML = '<div class="run empty"><span class="name">收件箱读取失败</span></div>';
      }
    }
  }

  function gateDiagBadge(d) {
    var status = d && d.status ? d.status : "";
    var behind = d && typeof d.commitsBehind === "number" ? d.commitsBehind : 0;
    var files = d && Array.isArray(d.conflictFiles) ? d.conflictFiles : [];
    if (status === "mergeable") {
      return '<span class="diag diag-ok"><span class="dot dot-success"></span>可合</span>';
    }
    if (status === "stale-conflict") {
      var fileTxt = files.length ? " · 撞 " + files.slice(0, 3).map(escHtml).join(",") + (files.length > 3 ? "…" : "") : "";
      return '<span class="diag diag-warn" title="陈旧基底,硬合会回退别人改动,需 rebase 重跑">陈旧冲突 · 落后 ' + behind + fileTxt + '</span>';
    }
    if (status === "ghost") {
      return '<span class="diag diag-ghost" title="分支已无未合并 commit,改动早被吸收,门是残留">幽灵门</span>' +
        '<button class="b" data-action="gate-discard" data-flow="' + escHtml(d.flowId) + '">一键清</button>';
    }
    if (status === "branch-missing") {
      return '<span class="diag diag-missing" title="对应分支已被删除">分支没了</span>' +
        '<button class="b" data-action="gate-discard" data-flow="' + escHtml(d.flowId) + '">清除</button>';
    }
    return "";
  }

  async function gatesDiagnosisLoad() {
    var slots = document.querySelectorAll("[data-gate-diag]");
    if (!slots || !slots.length) return;
    try {
      var data = await getJson("/api/gates/diagnosis");
      var gates = data && Array.isArray(data.gates) ? data.gates : [];
      var byId = {};
      gates.forEach(function (g) { if (g && g.flowId) byId[g.flowId] = g; });
      slots.forEach(function (slot) {
        var fid = slot.getAttribute("data-gate-diag");
        var d = fid ? byId[fid] : null;
        slot.innerHTML = d ? gateDiagBadge(d) : "";
      });
    } catch (_e) {
      // 诊断读取失败:静默,不破坏门卡片主体
    }
  }

  async function escapeRateLoad() {
    var slots = document.querySelectorAll("[data-escape-rate]");
    var compactSlots = document.querySelectorAll("[data-escape-rate-compact]");
    if ((!slots || !slots.length) && (!compactSlots || !compactSlots.length)) return;
    try {
      var data = await getJson("/api/escape-rate");
      if (!data || !data.ok) {
        slots.forEach(function (s) { s.innerHTML = "逃逸率暂不可用"; });
        compactSlots.forEach(function (s) { s.innerHTML = "—"; });
        return;
      }
      var pct = function (r) { return (Number(r || 0) * 100).toFixed(1) + "%"; };
      var t = data.total || { rate: 0, mergedCount: 0, escapedCount: 0 };
      var w = data.total7d || { rate: 0, mergedCount: 0, escapedCount: 0 };
      var projects = Array.isArray(data.projects) ? data.projects : [];
      var rows = projects.filter(function (p) { return p.mergedCount > 0; }).map(function (p) {
        return "<div style=\\"display:flex;justify-content:space-between;padding:3px 0;border-top:1px solid var(--line)\\">"
          + "<span>" + escHtml(p.name) + "</span>"
          + "<span>全程 " + pct(p.rate) + "（逃 " + p.escapedCount + "/合 " + p.mergedCount + "）· 近7天 " + pct(p.rate7d) + "</span>"
          + "</div>";
      }).join("");
      var head = "<div style=\\"display:flex;gap:24px;flex-wrap:wrap;margin-bottom:6px\\">"
        + "<b style=\\"color:var(--ink)\\">全程逃逸率 " + pct(t.rate) + "</b>"
        + "<span>合并 " + t.mergedCount + " · 逃逸 " + t.escapedCount + "</span>"
        + "<span>近7天 " + pct(w.rate) + "（合 " + w.mergedCount + " · 逃 " + w.escapedCount + "）</span>"
        + "</div>";
      slots.forEach(function (slot) { slot.innerHTML = head + rows; });
      compactSlots.forEach(function (slot) { slot.innerHTML = pct(t.rate); });
    } catch (_e) {
      slots.forEach(function (s) { s.innerHTML = "逃逸率读取失败"; });
      compactSlots.forEach(function (s) { s.innerHTML = "—"; });
    }
  }

  document.addEventListener("click", function (event) {
    var themeEl = event.target && event.target.closest ? event.target.closest("[data-theme-set]") : null;
    if (!themeEl) return;
    event.preventDefault();
    setTheme(themeEl.getAttribute("data-theme-set"));
  });

  document.addEventListener("change", function (event) {
    var toggle = event.target && event.target.closest ? event.target.closest("[data-push-toggle]") : null;
    if (!toggle) return;
    toggle.disabled = true;
    setPushEnabled(toggle.checked === true).catch(function (error) {
      setPushSettingState(false, error instanceof Error ? error.message : String(error));
      toast(error instanceof Error ? error.message : String(error));
    }).finally(function () {
      toggle.disabled = false;
    });
  });

  document.addEventListener("submit", function (event) {
    var form = event.target && event.target.closest ? event.target.closest("[data-taskboard-create]") : null;
    if (!form) return;
    event.preventDefault();
    var subjectEl = form.querySelector('[name="subject"]');
    var subject = subjectEl && subjectEl.value ? String(subjectEl.value).trim() : "";
    if (!subject) {
      taskBoardSetMessage("任务标题不能为空", true);
      return;
    }
    var submit = form.querySelector('[type="submit"]');
    taskBoardMutate(
      submit,
      "/api/taskboard/create",
      { subject: subject, createdBy: taskBoardOwner() },
      "协作任务已创建"
    ).then(function (succeeded) {
      if (succeeded && form.reset) form.reset();
    }).catch(function (error) {
      taskBoardSetMessage(error && error.message ? error.message : String(error), true);
    });
  });

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest
      ? event.target.closest("[data-taskboard-claim],[data-taskboard-complete],[data-taskboard-reap]")
      : null;
    if (!target) return;
    event.preventDefault();
    if (target.hasAttribute("data-taskboard-claim")) {
      taskBoardMutate(
        target,
        "/api/taskboard/claim",
        { id: target.getAttribute("data-taskboard-claim") || "", owner: taskBoardOwner() },
        "任务已认领"
      ).catch(function (error) {
        taskBoardSetMessage(error && error.message ? error.message : String(error), true);
      });
      return;
    }
    if (target.hasAttribute("data-taskboard-complete")) {
      taskBoardMutate(
        target,
        "/api/taskboard/complete",
        { id: target.getAttribute("data-taskboard-complete") || "" },
        "任务已完成"
      ).catch(function (error) {
        taskBoardSetMessage(error && error.message ? error.message : String(error), true);
      });
      return;
    }
    taskBoardMutate(
      target,
      "/api/taskboard/reap",
      {},
      function (result) {
        var released = result && typeof result.released === "number" ? result.released : 0;
        return "已释放 " + released + " 个死主任务";
      }
    ).catch(function (error) {
      taskBoardSetMessage(error && error.message ? error.message : String(error), true);
    });
  });

  document.addEventListener("submit", function (event) {
    var form = event.target && event.target.closest ? event.target.closest("[data-task-create]") : null;
    if (!form) return;
    event.preventDefault();
    (async function () {
      try {
        var titleEl = form.querySelector('[name="title"]');
        var goalEl = form.querySelector('[name="goal"]');
        var acceptanceEl = form.querySelector('[name="acceptance"]');
        var typeEl = form.querySelector('[name="type"]');
        var acceptanceCriteria = (acceptanceEl && acceptanceEl.value ? String(acceptanceEl.value) : "")
          .split("\\n")
          .map(function (line) { return line.trim(); })
          .filter(Boolean);
        var payload = {
          projectId: currentProjectId(),
          type: typeEl && typeEl.value ? String(typeEl.value) : "feature",
          title: titleEl && titleEl.value ? String(titleEl.value).trim() : "",
          goal: goalEl && goalEl.value ? String(goalEl.value).trim() : "",
          acceptanceCriteria: acceptanceCriteria
        };
        var res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        var json = await res.json();
        if (!res.ok) {
          var problems = json && Array.isArray(json.problems) ? json.problems.join("；") : (json && json.error) || "创建失败";
          toast(problems);
          return;
        }
        toast("任务已创建");
        if (form.reset) form.reset();
        await loadTodaySection();
      } catch (_err) {
        toast("创建失败：网络或服务错误");
      }
    })().catch(function () {
      toast("创建失败：网络或服务错误");
    });
  });

`;
