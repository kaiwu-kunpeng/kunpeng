export const part07: string = `  document.addEventListener("click", function (event) {
    var el = actionElement(event.target);
    if (!el) return;
    event.preventDefault();
    (async function () {
      try {
        var action = attr(el, "data-action");
        var projectId = currentProjectId();
        var inboxApprovalConfirmed = el.hasAttribute("data-kp-armed");
        if (action === "merge-main" || action === "approve-apply" || action === "confirm-release" || action === "approve-connector" || action === "ops-gate-approve") {
          var inboxConfirm = attr(el, "data-kp-confirm");
          if (inboxConfirm && !inboxApprovalConfirmed) {
            if (!window.confirm(inboxConfirm)) return;
            inboxApprovalConfirmed = true;
          }
        }
        if (action === "today-refresh") {
          await loadTodaySection();
          return;
        }
        if (action === "task-transition") {
          var taskId = attr(el, "data-id") || "";
          var taskTo = attr(el, "data-to") || "";
          var todayBox = document.querySelector("[data-today-summary]");
          if (!taskId || !taskTo) {
            if (todayBox) todayBox.insertAdjacentHTML("afterbegin", '<div class="run empty"><span class="name">任务流转失败：缺少任务或目标状态</span></div>');
            return;
          }
          var taskRes = await fetch("/api/tasks/transition", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: currentProjectId(), id: taskId, to: taskTo })
          });
          var taskJson = await taskRes.json().catch(function () { return {}; });
          if (!taskRes.ok || !taskJson || taskJson.ok !== true) {
            if (todayBox) todayBox.insertAdjacentHTML("afterbegin", '<div class="run empty"><span class="name">任务流转失败：' + escHtml((taskJson && (taskJson.error || taskJson.problems && taskJson.problems.join("；"))) || "未知错误") + '</span></div>');
            return;
          }
          await loadTodaySection();
          return;
        }
        if (action === "run") {
          var req = window.prompt("描述要做的需求（留空取消）");
          if (!req) return;
          await postJson("/api/run", { projectId: projectId, requirement: req }, "已启动");
          return;
        }
        if (action === "register-project") {
          var repoPathEl = document.querySelector('[data-field="repoPath"]');
          var nameEl = document.querySelector('[data-field="name"]');
          var repoPath = repoPathEl && repoPathEl.value ? String(repoPathEl.value) : "";
          var name = nameEl && nameEl.value ? String(nameEl.value) : "";
          await postJson("/api/register-project", { repoPath: repoPath, name: name }, "已接管项目");
          return;
        }
        if (action === "change-password") {
          var curEl = document.querySelector('[data-field="currentPassword"]');
          var newEl = document.querySelector('[data-field="newPassword"]');
          var confEl = document.querySelector('[data-field="confirmPassword"]');
          var cur = curEl && curEl.value ? String(curEl.value) : "";
          var nw = newEl && newEl.value ? String(newEl.value) : "";
          var conf = confEl && confEl.value ? String(confEl.value) : "";
          if (nw !== conf) { toast("两次新密码不一致"); return; }
          await postJson("/api/auth/change-password", { currentPassword: cur, newPassword: nw }, "密码已修改");
          if (curEl) curEl.value = "";
          if (newEl) newEl.value = "";
          if (confEl) confEl.value = "";
          return;
        }
        if (action === "save-notify") {
          var nf = {};
          document.querySelectorAll("[data-nf]").forEach(function (node) { nf[node.getAttribute("data-nf")] = node.value ? String(node.value).trim() : ""; });
          await postJson("/api/settings/notify", nf, "已保存通讯设置");
          return;
        }
        if (action === "test-notify") {
          var nfResult = document.querySelector("[data-nf-result]");
          if (nfResult) nfResult.textContent = "正在发送测试…";
          try {
            var nfTest = await postJson("/api/settings/notify/test", {}, "测试推送已完成", { skipRender: true });
            if (nfResult) nfResult.textContent = nfTest.error || ("已送达：" + ((nfTest.sent || []).join("、") || "无") + "；失败：" + ((nfTest.failed || []).join("、") || "无"));
          } catch (error) {
            if (nfResult) nfResult.textContent = "发送测试失败：" + String(error);
          }
          return;
        }
        if (action === "add-account") {
          var auEl = document.querySelector('[data-acct="username"]');
          var apEl = document.querySelector('[data-acct="password"]');
          var arEl = document.querySelector('[data-acct="role"]');
          var afEl = document.querySelector('[data-acct="profileId"]');
          var au = auEl && auEl.value ? String(auEl.value).trim() : "";
          var ap = apEl && apEl.value ? String(apEl.value) : "";
          if (!au || !ap) { toast("用户名和初始密码必填"); return; }
          var addRes = await postJson("/api/accounts", {
            username: au,
            password: ap,
            role: arEl && arEl.value === "owner" ? "owner" : "member",
            profileId: afEl && afEl.value ? String(afEl.value).trim() : "home"
          }, "已添加账号");
          if (addRes && !addRes.error && auEl) auEl.value = "";
          if (addRes && !addRes.error && apEl) apEl.value = "";
          return;
        }
        if (action === "delete-account") {
          var delUser = attr(el, "data-username");
          if (!delUser) return;
          if (!confirm("确认删除账号「" + delUser + "」？该用户将无法再登录。")) return;
          try {
            var dr = await fetch("/api/accounts?username=" + encodeURIComponent(delUser), { method: "DELETE" });
            var dj = await dr.json();
            toast(dj.note || dj.error || "已删除账号");
            if (dj && !dj.error) await loadAccounts();
          } catch (_e) { toast("删除失败"); }
          return;
        }
        if (action === "toggle-section") {
          var sec = el.closest(".acc-sec");
          if (!sec) return;
          var secBody = sec.querySelector(".acc-body");
          var secCaret = sec.querySelector(".acc-caret");
          var nowOpen = sec.getAttribute("data-acc-open") !== "1";
          sec.setAttribute("data-acc-open", nowOpen ? "1" : "0");
          if (secBody) secBody.style.display = nowOpen ? "" : "none";
          if (secCaret) secCaret.textContent = nowOpen ? "▾" : "▸";
          return;
        }
        if (action === "edit-account") {
          var eBox = document.getElementById("acctEditBox");
          if (!eBox) return;
          var eUser = attr(el, "data-username");
          eBox.setAttribute("data-edit-original", eUser || "");
          var eName = document.getElementById("acctEditName");
          if (eName) eName.textContent = eUser || "";
          var eU = document.querySelector('[data-edit="username"]');
          var eR = document.querySelector('[data-edit="role"]');
          var eP = document.querySelector('[data-edit="profileId"]');
          var ePw = document.querySelector('[data-edit="newPassword"]');
          if (eU) eU.value = eUser || "";
          if (eR) eR.value = attr(el, "data-role") === "owner" ? "owner" : "member";
          if (eP) eP.value = attr(el, "data-profile") || "";
          if (ePw) ePw.value = "";
          eBox.style.display = "flex";
          return;
        }
        if (action === "cancel-edit-account") {
          var cBox = document.getElementById("acctEditBox");
          if (cBox) cBox.style.display = "none";
          return;
        }
        if (action === "save-edit-account") {
          var sBox = document.getElementById("acctEditBox");
          if (!sBox) return;
          var orig = sBox.getAttribute("data-edit-original") || "";
          if (!orig) { toast("缺少原账号"); return; }
          var sU = document.querySelector('[data-edit="username"]');
          var sR = document.querySelector('[data-edit="role"]');
          var sP = document.querySelector('[data-edit="profileId"]');
          var sPw = document.querySelector('[data-edit="newPassword"]');
          var payload = { username: orig };
          var nuv = sU && sU.value ? String(sU.value).trim() : "";
          if (nuv && nuv !== orig) payload.newUsername = nuv;
          if (sR && sR.value) payload.role = sR.value === "owner" ? "owner" : "member";
          if (sP && sP.value) payload.profileId = String(sP.value).trim();
          if (sPw && sPw.value) payload.newPassword = String(sPw.value);
          try {
            var pr = await fetch("/api/accounts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
            var pj = await pr.json();
            toast(pj.error || "已保存修改");
            if (pj && !pj.error) { sBox.style.display = "none"; await loadAccounts(); }
          } catch (_e) { toast("保存失败"); }
          return;
        }
        if (action === "sb-send") {
          var toEl = document.querySelector("[data-sb-to]");
          var bodyEl = document.querySelector("[data-sb-body]");
          var topicEl = document.querySelector("[data-sb-topic]");
          var urgentEl = document.querySelector("[data-sb-urgent]");
          var sbTo = toEl && toEl.value ? String(toEl.value).trim() : "";
          var sbBody = bodyEl && bodyEl.value ? String(bodyEl.value).trim() : "";
          if (!sbTo || !sbBody) { toast("缺收件人或正文"); return; }
          await postJson("/api/switchboard/send", {
            from: SB_AS,
            to: sbTo,
            body: sbBody,
            topic: topicEl && topicEl.value ? String(topicEl.value).trim() : undefined,
            urgent: !!(urgentEl && urgentEl.checked)
          }, "已发送");
          if (bodyEl) bodyEl.value = "";
          if (urgentEl) urgentEl.checked = false;
          await switchboardLoad();
          return;
        }
        if (action === "save-backends") {
          var routing = {};
          document.querySelectorAll("[data-stage]").forEach(function (node) {
            var stage = node.getAttribute("data-stage") || "";
            if (stage) routing[stage] = node.value;
          });
          await postJson("/api/settings/backends", { projectId: projectId, routing: routing }, "已保存后端配置");
          return;
        }
        if (action === "loop-run") {
          var loopId = attr(el, "data-loop-id");
          var loopProject = attr(el, "data-project-id") || projectId;
          if (!loopId || !window.confirm("从看板起 loop『" + loopId + "』一轮 wave？")) return;
          await postJson("/api/loop-run", { projectId: loopProject, loopId: loopId }, "已启动一轮 wave");
          return;
        }
        if (action === "loop-weakpoints") {
          var weakLoopId = attr(el, "data-loop");
          var weakProject = attr(el, "data-project-id") || "";
          var weakCard = el.closest ? el.closest(".loop-card") : null;
          var weakBox = weakCard && weakCard.querySelector ? weakCard.querySelector("[data-loop-weakpoints]") : null;
          if (!weakLoopId || !weakBox) return;
          weakBox.innerHTML = '<div class="run empty"><span class="name">动作建议刷新中...</span></div>';
          try {
            var weakRes = await fetch("/api/loop-weakpoints", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ loopId: weakLoopId, projectId: weakProject }),
            });
            var weakJson = await weakRes.json();
            if (!weakJson || !weakJson.ok) {
              weakBox.innerHTML = '<div class="run empty"><span class="name">动作建议读取失败：' + escHtml(weakJson && weakJson.error ? weakJson.error : "未知错误") + '</span></div>';
              return;
            }
            var weakPoints = Array.isArray(weakJson.weakPoints) ? weakJson.weakPoints : [];
            weakBox.innerHTML = weakPoints.length ? weakPoints.map(function (wp) {
              var delta = wp && wp.expectedDelta !== undefined && wp.expectedDelta !== null
                ? '<span class="hint">预计增量 ' + escHtml(wp.expectedDelta) + '</span>'
                : "";
              return '<div class="run">'
                + '<span class="name">' + escHtml(wp && wp.target) + '</span>'
                + '<span class="hint">' + escHtml(wp && wp.reason) + '</span>'
                + '<span class="stage">urgency ' + escHtml(wp && wp.urgency) + '</span>'
                + delta
                + '</div>';
            }).join("") : '<div class="run empty"><span class="name">暂无动作建议</span></div>';
          } catch (_e) {
            weakBox.innerHTML = '<div class="run empty"><span class="name">动作建议读取失败：网络或服务错误</span></div>';
          }
          return;
        }
        if (action === "lever-to-task") {
          var leverLoopId = attr(el, "data-loop-id");
          var leverProject = attr(el, "data-project-id") || projectId;
          var leverId = attr(el, "data-lever-id");
          var leverLabel = attr(el, "data-lever-label");
          var leverRes = await postJson("/api/loop-lever-to-task", {
            projectId: leverProject,
            loopId: leverLoopId,
            leverId: leverId,
            leverLabel: leverLabel,
          }, "已转任务", { skipRender: true });
          if (leverRes && leverRes.ok) {
            el.textContent = "已转任务";
            el.setAttribute("disabled", "disabled");
            el.classList.add("muted");
          }
          return;
        }
        if (action === "ops-gate-approve") {
          var opsGateApproveId = attr(el, "data-id");
          var opsGateApproveProject = attr(el, "data-project") || projectId;
          if (!opsGateApproveId || (!inboxApprovalConfirmed && !window.confirm("批准并立刻起跑该 playbook 对应 loop？"))) return;
          // L4 硬门：没走过收件箱的两段式确认就再确认一次；服务端缺 confirmed:true 会拒绝。
          var opsGateConfirmed = inboxApprovalConfirmed;
          if (!opsGateConfirmed && attr(el, "data-level") === "L4") {
            if (!window.confirm("二次确认：该动作等级 L4（对外可见且不可逆或花钱），确定批准？")) return;
            opsGateConfirmed = true;
          }
          var opsGateApproveRes = await fetch("/api/ops-gate-decide", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: opsGateApproveProject, id: opsGateApproveId, decision: "approve", confirmed: opsGateConfirmed }),
          });
          if (opsGateApproveRes && opsGateApproveRes.ok) {
            renderView(currentRoute()).catch(function () {});
          }
          return;
        }
        if (action === "ops-gate-reject") {
          var opsGateRejectId = attr(el, "data-id");
          var opsGateRejectProject = attr(el, "data-project") || projectId;
          if (!opsGateRejectId) return;
          var opsGateRejectRes = await fetch("/api/ops-gate-decide", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: opsGateRejectProject, id: opsGateRejectId, decision: "reject" }),
          });
          if (opsGateRejectRes && opsGateRejectRes.ok) {
            renderView(currentRoute()).catch(function () {});
          }
          return;
        }
        if (action === "plan") {
          var md = await editablePlanOverlay("");
          if (!md) return;
          await postJson("/api/plan", { projectId: projectId, inlineMd: md }, "已提交方案");
          return;
        }
        if (action === "autopilot") {
          if (!window.confirm("自动合并所有【已验证】流到 main？（发布/高风险/提案不动，仍需你确认）")) return;
          await postJson("/api/autopilot", { projectId: projectId }, "已触发自动合并");
          return;
        }
        if (action === "gate-discard") {
          var discardFlow = flowId(el);
          if (!discardFlow || !window.confirm("清除门 " + discardFlow + "?（仅丢弃这个残留门,不改代码）")) return;
          await postJson("/api/gates/discard", { flowId: discardFlow }, "已清除");
          return;
        }
        if (action === "abandon-flow") {
          projectId = actionProject(el);
          var abandonId = flowId(el);
          if (!abandonId || !window.confirm("确认中止流 " + abandonId + "？")) return;
          await postJson("/api/abandon-flow", { projectId: projectId, flowId: abandonId }, "已中止");
          renderView(currentRoute()).catch(function () {});
          return;
        }
        if (action === "rerun-flow") {
          projectId = actionProject(el);
          var rerunFlowId = flowId(el);
          if (!rerunFlowId) return;
          var rrun = await postJson("/api/rerun", { projectId: projectId, flowId: rerunFlowId });
          overlay("重跑 · " + rerunFlowId, (rrun && rrun.note) || (rrun && rrun.error) || "已重跑");
          renderView(currentRoute()).catch(function () {});
          return;
        }
        if (action === "inbox-defer") {
          var deferKey = attr(el, "data-kp-defer");
          if (!deferKey) return;
          var deferResult = await postJson("/api/inbox/defer", { keys: [deferKey] }, "已稍后 24h", { skipRender: true });
          if (deferResult && deferResult.ok === true) {
            var deferCard = el.closest ? el.closest("[data-kp-inbox-item]") : null;
            if (deferCard) deferCard.remove();
          }
          return;
        }
        if (action === "inbox-dismiss") {
          var dismissKey = attr(el, "data-kp-dismiss");
          if (!dismissKey) return;
          try {
            await fetch("/api/inbox/dismiss", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ keys: [dismissKey] })
            });
          } catch (_e) {}
          var dismissCard = el.closest ? el.closest("[data-kp-inbox-item]") : null;
          if (dismissCard) dismissCard.remove();
          return;
        }
        if (action === "merge-main") {
          projectId = actionProject(el);
          var mergeFlowId = flowId(el);
          if (!mergeFlowId || (!inboxApprovalConfirmed && !window.confirm("确认合并 " + mergeFlowId + " → main？"))) return;
          await postJson("/api/merge", { projectId: projectId, flowId: mergeFlowId, target: "main" }, "已提交合并");
          return;
        }
        if (action === "approve-apply") {
          projectId = actionProject(el);
          var approveId = proposalId(el);
          if (!approveId || (!inboxApprovalConfirmed && !window.confirm("确认批准该提案？"))) return;
          await postJson("/api/approve", { projectId: projectId, id: approveId }, "已批准");
          return;
        }
        if (action === "confirm-release") {
          event.stopImmediatePropagation();
          projectId = actionProject(el);
          var rid = proposalId(el);
          if (!rid || (!inboxApprovalConfirmed && !window.confirm("确认发布 " + rid + "？"))) return;
          var releaseConfirm = await postJson("/api/confirm-release", { projectId: projectId, id: rid }, "已确认发布", { skipRender: true });
          if (releaseConfirm && releaseConfirm.needConfirm && releaseConfirm.confirmToken) {
            if (!window.confirm("二次确认：发布 " + rid + " 不可撤回，确定？")) return;
            await postJson("/api/confirm-release", { projectId: projectId, id: rid, confirmToken: releaseConfirm.confirmToken }, "已确认发布");
          }
          return;
        }
        if (action === "approve-connector") {
          projectId = actionProject(el);
          var cid = proposalId(el);
          if (!cid || (!inboxApprovalConfirmed && !window.confirm("放行高风险动作 " + cid + "？"))) return;
          await postJson("/api/approve-connector", { projectId: projectId, id: cid }, "已放行");
          return;
        }
        if (action === "reject") {
          projectId = actionProject(el);
          var rejectId = proposalId(el);
          if (!rejectId || !window.confirm("确认拒绝（丢弃）该提案？")) return;
          await postJson("/api/reject", { projectId: projectId, id: rejectId }, "已拒绝");
          return;
        }
        if (action === "view") {
          projectId = actionProject(el);
          var viewId = proposalId(el);
          if (!viewId) return;
          var viewJson = await getJson("/api/proposal-body?projectId=" + encodeURIComponent(projectId) + "&id=" + encodeURIComponent(viewId));
          overlay("提案 " + viewId, viewJson.body || viewJson.error || "");
          return;
        }
        if (action === "gate-diff") {
          projectId = actionProject(el);
          var diffFlowId = flowId(el);
          if (!diffFlowId) return;
          var diffJson = await getJson("/api/gate-diff?projectId=" + encodeURIComponent(projectId) + "&flowId=" + encodeURIComponent(diffFlowId));
          if (!diffJson || !diffJson.ok) {
            overlay("改动 " + diffFlowId, diffJson && diffJson.error ? diffJson.error : "无法读取改动");
            return;
          }
          overlayHtml("改动 " + diffFlowId, kpGateDiffCardHtml(diffFlowId, diffJson.diff || "（无 diff）"));
          kpHydrateGateCommentCards(document);
          return;
        }
        if (action === "eval-report") {
          var pid = attr(el, "data-id") || proposalId(el);
          if (!pid) return;
          var data = await getJson("/api/eval-report?projectId=" + encodeURIComponent(projectId) + "&id=" + encodeURIComponent(pid));
          overlay("差分报告 " + pid, (data && data.report && data.report.markdown) ? data.report.markdown : (data && data.error) || "无证据");
          return;
        }
        if (action === "view-plan") {
          var planId = attr(el, "data-plan") || "";
          if (!planId) return;
          var planJson = await getJson("/api/proposal-body?projectId=" + encodeURIComponent(projectId) + "&id=" + encodeURIComponent(planId));
          overlay("方案 " + planId, planJson.body || planJson.error);
          return;
        }
        if (action === "edit") {
          projectId = actionProject(el);
          var editId = proposalId(el);
          if (!editId) return;
          var editJson = await getJson("/api/proposal-body?projectId=" + encodeURIComponent(projectId) + "&id=" + encodeURIComponent(editId));
          var body = window.prompt("编辑提案正文", editJson.body || "");
          if (body === null) return;
          await postJson("/api/edit-proposal", { projectId: projectId, id: editId, body: body }, "已保存");
          return;
        }
        if (action === "flow-log") {
          var logFlowId = flowId(el);
          if (!logFlowId) return;
          var logJson = await getJson("/api/flow-log?projectId=" + encodeURIComponent(projectId) + "&flowId=" + encodeURIComponent(logFlowId));
          overlay("日志 " + logFlowId, logJson.log || logJson.error || "");
          return;
        }
        if (action === "kb-aggregate") {
          var qEl = document.querySelector("[data-kb-query]");
          var kbQuery = qEl && qEl.value ? qEl.value.trim() : "";
          var kb = await getJson("/api/kb" + (kbQuery ? "?query=" + encodeURIComponent(kbQuery) : ""));
          if (!kb.ok) { overlay("跨项目知识聚合", kb.error || "失败"); return; }
          var lines = (kb.entries || []).slice(0, 50).map(function (e) {
            return "[" + e.projectName + "] " + (e.summary || "").slice(0, 100) + "  (" + e.id + ")";
          });
          overlay("跨项目知识聚合（" + kb.projectCount + " 项目 · " + kb.count + " 条" + (kbQuery ? " · 过滤「" + kbQuery + "」" : "") + "）",
            lines.length ? lines.join("\\n") : "（无匹配）");
          return;
        }
        if (action === "evidence") {
          var evFlowId = flowId(el);
          if (!evFlowId) return;
          var ev = await getJson("/api/evidence?projectId=" + encodeURIComponent(projectId) + "&flowId=" + encodeURIComponent(evFlowId));
          if (ev.error) { overlay("证据 " + evFlowId, ev.error); return; }
          var verdict = ev.outcome === "verified" ? "✓ 已验证通过（声明完成 = 真过 test）"
            : ev.outcome === "rolled-back" ? "✗ 已回滚（验证未通过，已干净还原）"
            : "状态：" + ev.outcome;
          var text = "结论：" + verdict
            + (ev.reason ? "\\n原因：" + ev.reason : "")
            + "\\n\\n验证证据（test/lint/build 真实输出）：\\n"
            + (ev.evidence || "（无结构化证据：旧流或未记录验证输出）");
          overlay("证据 · " + evFlowId, text);
          return;
        }
        if (action === "trajectory") {
          var trFlowId = flowId(el);
          if (!trFlowId) return;
          await loadState();   // 取最新状态再渲时间线
          overlayHtml("轨迹 · " + trFlowId, trajectoryHtml(findFlowById(trFlowId)));
          return;
        }
        if (action === "submit-feedback") {
          var fbFlowId = flowId(el);
          var ta = document.getElementById("kp-fb-input");
          var msg = document.getElementById("kp-fb-msg");
          var raw = ta && ta.value ? String(ta.value).trim() : "";
          if (!fbFlowId || !raw) { if (msg) msg.textContent = "请先写意见"; return; }
          // 可选前缀 "file:line " 或 "file " → 拆成 file/line
          var m = /^([^\\s:]+\\.[a-zA-Z]+)(?::(\\d+))?\\s+([\\s\\S]+)$/.exec(raw);
          var payload = { projectId: projectId, flowId: fbFlowId, comment: raw };
          if (m) { payload = { projectId: projectId, flowId: fbFlowId, comment: m[3], file: m[1], line: m[2] ? Number(m[2]) : undefined }; }
          var fr = await postJson("/api/feedback", payload);
          if (msg) msg.textContent = (fr && fr.note) || (fr && fr.error) || "已提交";
          if (ta && fr && fr.ok) ta.value = "";
          return;
        }
        if (action === "reply-blocker") {
          projectId = actionProject(el);
          var replyFlowId = flowId(el);
          if (!replyFlowId) return;
          var replyInput = document.querySelector('[data-kp-reply-input="' + replyFlowId + '"]');
          var comment = replyInput && replyInput.value ? String(replyInput.value).trim() : "";
          if (!comment) { overlay("回复求助", "请先写回复"); return; }
          var replyResult = await postJson("/api/feedback", { projectId: projectId, flowId: replyFlowId, comment: comment });
          if (replyResult && replyResult.ok) {
            replyResult = await postJson("/api/resume", { projectId: projectId, flowId: replyFlowId });
          }
          overlay("回复并续跑 · " + replyFlowId, (replyResult && replyResult.note) || (replyResult && replyResult.error) || "请求失败");
          renderView(currentRoute()).catch(function () {});
          return;
        }
        if (action === "pause-flow") {
          var pFlowId = flowId(el);
          if (!pFlowId) return;
          var pr = await postJson("/api/pause", { projectId: projectId, flowId: pFlowId });
          overlay("暂停 · " + pFlowId, (pr && pr.note) || (pr && pr.error) || "已请求");
          renderView(currentRoute()).catch(function () {});
          return;
        }
        if (action === "resume-flow") {
          var rFlowId = flowId(el);
          if (!rFlowId) return;
          var rr = await postJson("/api/resume", { projectId: projectId, flowId: rFlowId });
          overlay("续跑 · " + rFlowId, (rr && rr.note) || (rr && rr.error) || "已续跑");
          renderView(currentRoute()).catch(function () {});
          return;
        }
        if (action === "design-advise") {
          var bEl = document.querySelector("[data-design-brief]");
          var brief = bEl && bEl.value ? String(bEl.value).trim() : "";
          if (!brief) return;
          var box = document.getElementById("design-advise-out");
          if (box) box.innerHTML = '<div class="run"><span class="name">生成中…</span></div>';
          try {
            var designRes = await fetch("/api/design-advise", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: brief }) });
            var designData = await designRes.json();
            if (box && designData && designData.ok) {
              var styleNames = (designData.styles || []).map(function (s) { return escHtml(s.name); }).join(" / ") || "—";
              var pal = designData.palette ? '<span class="tag" style="background:' + escHtml(designData.palette.primary) + ';color:#fff">primary ' + escHtml(designData.palette.primary) + '</span><span class="tag" style="background:' + escHtml(designData.palette.secondary) + ';color:#fff">secondary ' + escHtml(designData.palette.secondary) + '</span><span class="tag" style="background:' + escHtml(designData.palette.cta) + ';color:#fff">CTA ' + escHtml(designData.palette.cta) + '</span>' : "";
              var fonts = designData.fonts ? '<span class="muted">字体 ' + escHtml(designData.fonts.serif) + ' / ' + escHtml(designData.fonts.sans) + '</span>' : "";
              var gate = (designData.antiPatternHits && designData.antiPatternHits.length) ? '<span class="stage impl">✗ 反AI味命中 ' + designData.antiPatternHits.length + '</span>' : '<span class="stage verify">✓ 通过反AI味门禁</span>';
              box.innerHTML =
                '<div class="run"><span class="tag">推荐风格</span><span class="name">' + styleNames + '</span></div>' +
                '<div class="run">' + pal + fonts + '</div>' +
                '<div class="run">' + gate + '</div>' +
                '<div class="run"><span class="name" style="white-space:pre-wrap;font-size:12px">' + escHtml(designData.css) + '</span></div>';
            } else if (box) {
              box.innerHTML = '<div class="run"><span class="name">出错：' + escHtml(designData && designData.error) + '</span></div>';
            }
          } catch (_err) {
            if (box) box.innerHTML = '<div class="run"><span class="name">请求失败</span></div>';
          }
          return;
        }
        if (action === "design-loop") {
          var dlBriefEl = document.querySelector("[data-dl-brief]");
          var dlSeedEl = document.querySelector("[data-dl-seed]");
          var dlAnchorsEl = document.querySelector("[data-dl-anchors]");
          var dlBox = document.getElementById("design-loop-out");
          var briefRaw = dlBriefEl && dlBriefEl.value ? String(dlBriefEl.value).trim() : "";
          if (!briefRaw) { if (dlBox) dlBox.innerHTML = '<div class="run"><span class="name">请粘贴 BRIEF(JSON)</span></div>'; return; }
          var briefObj;
          try { briefObj = JSON.parse(briefRaw); } catch (_e) { if (dlBox) dlBox.innerHTML = '<div class="run"><span class="name">BRIEF 不是合法 JSON</span></div>'; return; }
          var seedVal = dlSeedEl && dlSeedEl.value ? String(dlSeedEl.value).trim() : "#2563eb";
          var anchorsVal = dlAnchorsEl && dlAnchorsEl.value ? String(dlAnchorsEl.value).split(",").map(function (s) { return s.trim(); }).filter(Boolean) : undefined;
          if (dlBox) dlBox.innerHTML = '<div class="run"><span class="name">跑 Loop…</span></div>';
          try {
            var dlRes = await fetch("/api/design-loop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: briefObj, seed: seedVal, anchors: anchorsVal }) });
            var dl = await dlRes.json();
            if (!dlBox) return;
            if (!dl || dl.ok !== true) {
              var miss = dl && dl.gate && dl.gate.missing && dl.gate.missing.length ? '<div class="run"><span class="stage impl">✗ 投资门未过</span><span class="name">缺失: ' + escHtml((dl.gate.missing || []).join(", ")) + '</span></div>' : '';
              var viol = dl && dl.gate && dl.gate.violations && dl.gate.violations.length ? '<div class="run"><span class="name">违规: ' + escHtml(dl.gate.violations.join("; ")) + '</span></div>' : '';
              dlBox.innerHTML = (miss + viol) || ('<div class="run"><span class="name">出错: ' + escHtml(dl && dl.error) + '</span></div>');
              return;
            }
            var tk = dl.tokens || { light: {}, dark: {} };
            function sw(name, hex) { return hex ? '<span class="tag" style="background:' + escHtml(hex) + ';color:#fff">' + escHtml(name) + ' ' + escHtml(hex) + '</span>' : ''; }
            var lt = tk.light || {}, dk = tk.dark || {};
            var swatches = sw("primary", lt.primary && lt.primary.$value) + sw("bg", lt.background && lt.background.$value) + sw("accent", lt.accent && lt.accent.$value) + sw("暗bg", dk.background && dk.background.$value);
            var anchorLine = dl.chosenAnchor ? '<span class="tag">选锚 ' + escHtml(dl.chosenAnchor) + '</span><span class="muted">候选: ' + escHtml((dl.rankedAnchors || []).join(" > ")) + '</span>' : '<span class="muted">未给候选锚</span>';
            dlBox.innerHTML =
              '<div class="run"><span class="stage verify">✓ 投资门过</span>' + anchorLine + '</div>' +
              '<div class="run">' + swatches + '</div>' +
              '<div class="run"><span class="muted">系统提示词(' + ((dl.systemPrompt || "").length) + ' 字,喂生成器):</span></div>' +
              '<div class="run"><textarea class="name" style="height:160px;font-size:11px" readonly>' + escHtml(dl.systemPrompt || "") + '</textarea></div>';
          } catch (_e2) {
            if (dlBox) dlBox.innerHTML = '<div class="run"><span class="name">请求失败</span></div>';
          }
          return;
        }
        if (action === "design-generate") {
          var gBriefEl = document.querySelector("[data-dl-brief]");
          var gRaw = gBriefEl && gBriefEl.value ? String(gBriefEl.value).trim() : "";
          if (!gRaw) { toast("请粘 BRIEF(JSON)"); return; }
          var gObj;
          try { gObj = JSON.parse(gRaw); } catch (_e) { toast("BRIEF 不是合法 JSON"); return; }
          if (!window.confirm("后台生成设计页面?(跑 LLM,几分钟,产物落 .kunpeng/design-out)")) return;
          var gSeedEl = document.querySelector("[data-dl-seed]");
          var gAnchEl = document.querySelector("[data-dl-anchors]");
          var gRoundsEl = document.querySelector("[data-dl-rounds]");
          await postJson("/api/design-generate", {
            projectId: currentProjectId(),
            brief: gObj,
            seed: gSeedEl && gSeedEl.value ? String(gSeedEl.value).trim() : undefined,
            anchors: gAnchEl && gAnchEl.value ? String(gAnchEl.value).split(",").map(function (s) { return s.trim(); }).filter(Boolean) : undefined,
            rounds: gRoundsEl && gRoundsEl.value ? Number(gRoundsEl.value) : undefined,
          }, "已启动后台生成");
          return;
        }
        if (action === "design-preview") {
          var presetEl = document.querySelector("[data-design-preset]");
          var preset = presetEl && presetEl.value ? String(presetEl.value) : undefined;
          await postJson("/api/design-preview", { projectId: projectId, preset: preset }, "候选生成已启动（后台跑 LLM，几分钟）");
          return;
        }
        if (action === "design-codegen") {
          if (!window.confirm("启动设计代码生成？")) return;
          await postJson("/api/design-codegen", { projectId: projectId }, "已启动设计代码生成");
          return;
        }
        if (action === "select-design") {
          var source = attr(el, "data-source") || "";
          var anchor = attr(el, "data-anchor") || "";
          await postJson("/api/select-design", { projectId: projectId, source: source, anchor: anchor }, "已选择设计");
          return;
        }
        if (action === "knowledge-promote") {
          var kid = attr(el, "data-id");
          if (!kid) return;
          await postJson("/api/knowledge-promote", { projectId: projectId, id: kid }, "已采纳");
          return;
        }
        if (action === "knowledge-delete") {
          var delId = attr(el, "data-id");
          if (!delId) return;
          if (attr(el, "data-armed") !== "1") {
            var delLabel = el.textContent || "删除";
            el.setAttribute("data-armed", "1");
            el.setAttribute("data-original-label", delLabel);
            el.textContent = "确认删除?";
            window.setTimeout(function () {
              if (attr(el, "data-armed") !== "1") return;
              el.setAttribute("data-armed", "0");
              el.textContent = attr(el, "data-original-label") || delLabel;
              el.removeAttribute("data-original-label");
            }, 3000);
            return;
          }
          el.setAttribute("data-armed", "0");
          el.removeAttribute("data-original-label");
          var delRow = el.closest ? el.closest("[data-capture]") : null;
          var delRes = await postJson("/api/knowledge-delete", { projectId: projectId, id: delId }, "已删除");
          if (delRes && delRes.ok && delRow && delRow.parentNode) delRow.parentNode.removeChild(delRow);
          return;
        }
        if (action === "knowledge-edit") {
          var editId = attr(el, "data-id");
          if (!editId) return;
          var editRow = el.closest ? el.closest("[data-capture]") : null;
          if (!editRow) return;
          var oldInline = editRow.querySelector ? editRow.querySelector("[data-knowledge-edit-row]") : null;
          if (oldInline && oldInline.parentNode) oldInline.parentNode.removeChild(oldInline);
          var editLine = document.createElement("div");
          editLine.setAttribute("data-knowledge-edit-row", editId);
          editLine.style.flexBasis = "100%";
          editLine.style.display = "flex";
          editLine.style.gap = "8px";
          editLine.style.alignItems = "center";
          editLine.style.marginTop = "8px";
          var editTitle = attr(editRow, "data-title") || "";
          var editTags = attr(editRow, "data-tags") || "";
          editLine.innerHTML = '<input data-knowledge-edit-title value="' + escHtml(editTitle) + '" placeholder="标题" style="min-width:180px;flex:1;border:1px solid var(--line);border-radius:6px;padding:6px 8px">' +
            '<input data-knowledge-edit-tags value="' + escHtml(editTags) + '" placeholder="标签，用逗号分隔" style="min-width:180px;flex:1;border:1px solid var(--line);border-radius:6px;padding:6px 8px">' +
            '<button class="b pri" data-action="knowledge-edit-save" data-id="' + escHtml(editId) + '">保存</button>';
          editRow.appendChild(editLine);
          return;
        }
        if (action === "knowledge-edit-save") {
          var saveId = attr(el, "data-id");
          if (!saveId) return;
          var saveRow = el.closest ? el.closest("[data-capture]") : null;
          if (!saveRow) return;
          var titleInput = saveRow.querySelector ? saveRow.querySelector("[data-knowledge-edit-title]") : null;
          var tagsInput = saveRow.querySelector ? saveRow.querySelector("[data-knowledge-edit-tags]") : null;
          var queryInput = document.querySelector("[data-knowledge-input]");
          var currentQuery = queryInput && queryInput.value ? String(queryInput.value).trim() : "";
          var editRes = await postJson("/api/knowledge-edit", {
            projectId: projectId,
            id: saveId,
            title: titleInput && titleInput.value ? String(titleInput.value) : "",
            tags: tagsInput && tagsInput.value ? String(tagsInput.value) : "",
          }, "已保存");
          if (editRes && !editRes.error) await knowledgeLoad(currentQuery);
          return;
        }
        if (action === "knowledge-distill-card") {
          var did = attr(el, "data-id");
          if (!did) return;
          await postJson("/api/knowledge-distill-card", { projectId: projectId, id: did }, "已深读");
          return;
        }
        if (action === "knowledge-tag") {
          var tg = attr(el, "data-tag");
          if (!tg) return;
          var ki = document.querySelector("[data-knowledge-input]");
          if (ki) ki.value = tg;
          await knowledgeLoad(tg);
          return;
        }
        if (action === "knowledge-capture") {
          var box = document.querySelector("[data-knowledge-capture-input]");
          var text = box && box.value ? String(box.value).trim() : "";
          if (!text) { toast("请先粘贴要捕获的文本"); return; }
          var r = await postJson("/api/knowledge-capture", { projectId: projectId, text: text }, "已捕获");
          if (r && !r.error && box) box.value = "";
          return;
        }
        if (action === "distill-skill") {
          var nameEl = document.querySelector("[data-distill-name]");
          var descEl = document.querySelector("[data-distill-desc]");
          var dname = nameEl && nameEl.value ? String(nameEl.value).trim() : "";
          var ddesc = descEl && descEl.value ? String(descEl.value).trim() : "";
          if (!dname) { return; }
          await postJson("/api/distill-skill", { projectId: projectId, name: dname, description: ddesc || dname }, "已蒸馏技能");
          if (nameEl) nameEl.value = "";
          if (descEl) descEl.value = "";
          return;
        }
        if (action === "knowledge-capture-url") {
          var ub = document.querySelector("[data-knowledge-capture-url]");
          var u = ub && ub.value ? String(ub.value).trim() : "";
          if (!u) { toast("请先粘贴网址"); return; }
          toast("抓取中…（鲲鹏正在读取并整理）");
          var ur = await postJson("/api/knowledge-capture", { projectId: projectId, kind: "url", value: u }, "已抓取并整理");
          if (ur && !ur.error && ub) ub.value = "";
          return;
        }
        if (action === "knowledge-ask") {
          var qEl = document.querySelector("[data-knowledge-ask-input]");
          var askQ = qEl && qEl.value ? String(qEl.value).trim() : "";
          if (!askQ) return;
          var askBox = document.getElementById("knowledge-answer");
          if (askBox) askBox.innerHTML = '<div class="run"><span class="name">思考中…</span></div>';
          try {
            var askRes = await fetch("/api/knowledge-ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projectId, question: askQ }) });
            var askData = await askRes.json();
            if (askBox) {
              if (askData && askData.ok) {
                var askSrcs = Array.isArray(askData.sources) ? askData.sources.map(function (s) { return escHtml(s.id); }).join(" · ") : "";
                askBox.innerHTML = '<div class="run"><span class="name" style="white-space:pre-wrap">' + escHtml(askData.answer) + '</span></div>' + (askSrcs ? '<div class="run"><span class="muted">来源：' + askSrcs + '</span></div>' : '');
              } else {
                askBox.innerHTML = '<div class="run"><span class="name">出错：' + escHtml(askData && askData.error) + '</span></div>';
              }
            }
          } catch (_err) {
            if (askBox) askBox.innerHTML = '<div class="run"><span class="name">请求失败</span></div>';
          }
          return;
        }
        if (action === "knowledge-synth") {
          var cat = attr(el, "data-category");
          if (!cat) return;
          var synthBox = document.getElementById("knowledge-synth-out");
          if (synthBox) synthBox.innerHTML = '<div class="run"><span class="name">综述「' + escHtml(cat) + '」中…</span></div>';
          try {
            var synthRes = await fetch("/api/knowledge-synthesize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: currentProjectId(), category: cat }) });
            var synthData = await synthRes.json();
            if (synthBox) {
              if (synthData && synthData.ok) {
                var synthSrcs = Array.isArray(synthData.sources) ? synthData.sources.map(function (source) { return escHtml(source.id); }).join(" · ") : "";
                synthBox.innerHTML = '<div class="run"><span class="name" style="white-space:pre-wrap">' + escHtml(synthData.brief) + '</span></div>' + (synthSrcs ? '<div class="run"><span class="muted">来源：' + synthSrcs + '</span></div>' : '');
              } else {
                synthBox.innerHTML = '<div class="run"><span class="name">出错：' + escHtml(synthData && synthData.error) + '</span></div>';
              }
            }
          } catch (_err) {
            if (synthBox) synthBox.innerHTML = '<div class="run"><span class="name">请求失败</span></div>';
          }
          return;
        }
        if (action === "knowledge-tag") {
          var tg = attr(el, "data-tag");
          if (!tg) return;
          var ki = document.querySelector("[data-knowledge-input]");
          if (ki) ki.value = tg;
          await knowledgeLoad(tg);
          return;
        }
        if (action === "knowledge-search" || action === "knowledge-clear") {
          var inp = document.querySelector("[data-knowledge-input]");
          var q = action === "knowledge-clear" ? "" : (inp && inp.value ? String(inp.value).trim() : "");
          if (action === "knowledge-clear" && inp) inp.value = "";
          await knowledgeLoad(q);
          return;
        }
        function ivValue() {
          var box = el.closest && el.closest(".interview") ? el.closest(".interview").querySelector(".iv-input") : null;
          var input = box || document.querySelector(".iv-input");
          return input && input.value ? String(input.value).trim() : "";
        }
        if (action === "product-start") {
          var idea = ivValue();
          if (!idea) { toast("请先填写产品想法"); return; }
          await postJson("/api/product-start", { projectId: projectId, idea: idea }, "已开始 DEFINE 访谈");
          return;
        }
        if (action === "product-new") {
          var newInput = document.querySelector("[data-product-new-input]");
          var newIdea = newInput && newInput.value ? String(newInput.value).trim() : "";
          var newTemplateInput = document.querySelector("[data-product-new-template]");
          var newTemplate = newTemplateInput && newTemplateInput.value ? String(newTemplateInput.value) : "";
          if (!newIdea) { toast("请先填写产品想法"); return; }
          await postJson("/api/product/new", { projectId: projectId, idea: newIdea, template: newTemplate }, "已新建产品");
          return;
        }
        if (action === "product-open") {
          var openSlug = attr(el, "data-slug") || "";
          if (openSlug) {
            fetch("/api/product/activate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ projectId: currentProjectId(), slug: openSlug }),
            }).catch(function () {});
          }
          if (openSlug) { try { localStorage.setItem("kpSelectedProduct", openSlug); } catch (_e) {} renderView(currentRoute()); }
          return;
        }
        if (action === "product-snapshot") {
          var snapSlug = attr(el, "data-slug") || "";
          if (!snapSlug) return;
          await postJson("/api/product/snapshot", { projectId: projectId, slug: snapSlug, label: "手动存档" }, "已存检查点");
          return;
        }
        if (action === "product-rollback") {
          var rbSlug = attr(el, "data-slug") || "";
          var rbId = attr(el, "data-id") || "";
          if (!rbSlug || !rbId) return;
          if (!confirm("回滚到该检查点？会先自动存当前，可再前滚")) return;
          await postJson("/api/product/rollback", { projectId: projectId, slug: rbSlug, id: rbId }, "已回滚");
          return;
        }
        if (action === "product-ws-restore") {
          var wsRestoreSlug = attr(el, "data-slug") || "";
          var wsRestoreSha = attr(el, "data-sha") || "";
          if (!wsRestoreSlug || !wsRestoreSha) return;
          if (!window.confirm("恢复到该代码版本？会先自动存档当前，再追加恢复提交，预览将自动重启。")) return;
          var wsRestoreRes = await fetch("/api/product/ws-restore", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: projectId, slug: wsRestoreSlug, sha: wsRestoreSha }),
          });
          var wsRestoreJson = await wsRestoreRes.json().catch(function () { return {}; });
          toast(wsRestoreJson.error || "已恢复代码版本");
          if (wsRestoreJson && wsRestoreJson.ok) {
            renderView(currentRoute()).catch(function () {});
          }
          return;
        }
        if (action === "product-copy-ref") {
          var refInput = document.querySelector("[data-product-ref-input]");
          var refUrl = refInput && refInput.value ? String(refInput.value).trim() : "";
          if (!refUrl) { toast("请先填写参考产品网址"); return; }
          toast("正在抓取并解析参考产品…");
          await postJson("/api/product/copy-ref", { projectId: projectId, url: refUrl }, "已从参考产品生成");
          return;
        }
        if (action === "product-delete") {
          var slug = attr(el, "data-slug") || "";
          if (!slug) return;
          if (!confirm("确认删除产品「" + slug + "」？软删，可恢复")) return;
          await postJson("/api/product/delete", { projectId: projectId, slug: slug }, "已删除产品");
          return;
        }
        if (action === "product-purge") {
          var pgSlug = attr(el, "data-slug") || "";
          if (!pgSlug) return;
          if (attr(el, "data-armed") !== "1") {
            var originalText = el.textContent || "彻底删除";
            el.setAttribute("data-armed", "1");
            el.setAttribute("data-original-label", originalText);
            el.textContent = "再点一次确认删除";
            window.setTimeout(function () {
              if (attr(el, "data-armed") !== "1") return;
              el.removeAttribute("data-armed");
              el.textContent = attr(el, "data-original-label") || originalText;
              el.removeAttribute("data-original-label");
            }, 3000);
            return;
          }
          el.removeAttribute("data-armed");
          el.removeAttribute("data-original-label");
          await postJson("/api/product/purge", { projectId: projectId, slug: pgSlug }, "已彻底删除");
          return;
        }
        if (action === "product-restore") {
          var restoreSlug = attr(el, "data-slug") || "";
          if (!restoreSlug) return;
          await postJson("/api/product/restore", { projectId: projectId, slug: restoreSlug }, "已恢复产品");
          return;
        }
        if (action === "product-answer-submit") {
          var answer = ivValue();
          if (!answer) { toast("请先填写回答"); return; }
          await postJson("/api/product-answer", { projectId: projectId, answer: answer }, "已提交回答");
          return;
        }
        if (action === "product-to-spec") {
          await postJson("/api/product-to-spec", { projectId: projectId }, "已生成 spec 草稿");
          return;
        }
        if (action === "product-spec-save") {
          var specEl = document.querySelector("[data-product-spec]");
          var specSlug = attr(el, "data-slug") || "";
          await postJson("/api/product/spec/save", { projectId: projectId, slug: specSlug, spec: specEl ? specEl.value : "" }, "spec 已保存");
          return;
        }
        if (action === "product-accept") {
          var stage = el.getAttribute("data-stage") || "spec";
          var acceptSlug = attr(el, "data-slug") || "";
          await postJson("/api/product/accept", { projectId: projectId, slug: acceptSlug, stage: stage }, "已接受并推进");
          return;
        }
        if (action === "product-design-run") {
          var briefEl = document.querySelector("[data-product-brief]");
          var brief;
          try { brief = briefEl && briefEl.value ? JSON.parse(briefEl.value) : undefined; } catch (e) { toast("BRIEF JSON 解析失败"); return; }
          var designSlug = attr(el, "data-slug") || "";
          await postJson("/api/product/design/run", { projectId: projectId, slug: designSlug, brief: brief }, "已开始生成设计预览");
          return;
        }
        if (action === "product-buildspec-save") {
          var bsEl = document.querySelector("[data-product-buildspec]");
          await postJson("/api/product/buildspec/save", { projectId: projectId, buildSpec: bsEl ? bsEl.value : "" }, "可构建 spec 已保存");
          return;
        }
        if (action === "product-publish") {
          var pubSlug = attr(el, "data-slug") || "";
          if (!pubSlug) return;
          var pubRes = await fetch("/api/product/publish", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: projectId, slug: pubSlug }),
          });
          var pubJson = await pubRes.json();
          toast((pubJson.publish && pubJson.publish.url) || pubJson.error || "发布失败");
          if (pubJson && !pubJson.error) await renderRoute();
          return;
        }
        if (action === "product-preview-start") {
          var previewStartSlug = attr(el, "data-slug") || "";
          if (!previewStartSlug) return;
          var previewStartRes = await fetch("/api/product/preview/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: projectId, slug: previewStartSlug }),
          });
          var previewStartJson = await previewStartRes.json();
          toast((previewStartJson.preview && previewStartJson.preview.url) || previewStartJson.error || "启动预览失败");
          if (previewStartJson && !previewStartJson.error) await renderRoute();
          return;
        }
        if (action === "product-preview-stop") {
          var previewStopSlug = attr(el, "data-slug") || "";
          if (!previewStopSlug) return;
          var previewStopRes = await fetch("/api/product/preview/stop", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: projectId, slug: previewStopSlug }),
          });
          var previewStopJson = await previewStopRes.json();
          toast(previewStopJson.error || "已停止预览");
          if (previewStopJson && !previewStopJson.error) await renderRoute();
          return;
        }
        if (action === "product-qa-run") {
          var qaSlug = attr(el, "data-slug") || "";
          if (!qaSlug) return;
          var qaRes = await fetch("/api/product/qa", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: projectId, slug: qaSlug }),
          });
          var qaJson = await qaRes.json();
          var qaProblems = qaJson && Array.isArray(qaJson.problems) ? qaJson.problems.length : 0;
          toast(qaJson && qaJson.ok ? "QA 通过" : (qaJson && qaJson.error) || "QA 问题 " + qaProblems);
          if (qaJson && !qaJson.error) await renderRoute();
          return;
        }
        if (action === "product-checkup") {
          var checkupSlug = attr(el, "data-slug") || "";
          if (!checkupSlug) return;
          el.textContent = "验收中…";
          el.disabled = true;
          var checkupRes = await fetch("/api/product/checkup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: projectId, slug: checkupSlug }),
          });
          var checkupJson = await checkupRes.json();
          toast(checkupJson && checkupJson.ok ? "一键验收完成" : (checkupJson && checkupJson.error) || "一键验收失败");
          renderView(currentRoute()).catch(function () {});
          return;
        }
        if (action === "product-pick-task") {
          var pickSlug = el.dataset ? String(el.dataset.slug || "") : "";
          var pickSelector = el.dataset ? String(el.dataset.selector || "") : "";
          var pickText = el.dataset ? String(el.dataset.text || "") : "";
          var pickInstruction = window.prompt("这个元素要怎么改？");
          if (pickInstruction === null || pickInstruction.trim() === "") return;
          var pickRes = await fetch("/api/product/pick-task", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId: projectId,
              slug: pickSlug,
              selector: pickSelector,
              text: pickText,
              instruction: pickInstruction.trim()
            })
          });
          if (pickRes && pickRes.ok) {
            renderView(currentRoute()).catch(function () {});
          }
          return;
        }
        if (action === "product-validate-submit") {
          var sigEl = document.querySelector("[data-product-signals]");
          var hypEl = document.querySelector("[data-product-hypotheses]");
          var decEl = document.querySelector("[data-product-decision]");
          var ratEl = document.querySelector("[data-product-rationale]");
          var signals = (sigEl && sigEl.value ? sigEl.value : "").split("\\n").map(function (line) {
            var parts = line.split("|").map(function (s) { return s.trim(); });
            return { source: parts[0] || "", kind: parts[1] || "other", summary: parts[2] || "", synthetic: false };
          }).filter(function (s) { return s.source || s.summary; });
          var hypotheses = (hypEl && hypEl.value ? hypEl.value : "").split("\\n").map(function (s) { return s.trim(); }).filter(Boolean);
          await postJson("/api/product/validate", { projectId: projectId, signals: signals, hypotheses: hypotheses, decision: decEl ? decEl.value : "inconclusive", rationale: ratEl ? ratEl.value : "" }, "已提交验证");
          return;
        }
      } catch (_err) {
        toast("操作失败：网络或服务错误");
      }
    })().catch(function () {
      toast("操作失败：网络或服务错误");
    });
  });

  loadTheme();
  bindWorkspaceSwitcher();
  window.addEventListener("hashchange", function () {
    renderRoute().catch(function () {});
  });
  document.addEventListener("click", function (event) {
    var paletteTrigger = event.target && event.target.closest ? event.target.closest("[data-kp-palette]") : null;
    if (!paletteTrigger) return;
    event.preventDefault();
    var moreToggle = document.getElementById("kp-more-toggle");
    if (moreToggle) moreToggle.checked = false;
    togglePalette();
  });
  document.addEventListener("keydown", function (event) {
    var key = String(event.key || "").toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === 'k') {
      event.preventDefault();
      togglePalette();
      return;
    }
    if (key === "escape") {
      if (kpInboxCloseHelp()) event.preventDefault();
      closePalette();
      return;
    }
    if (!kpInboxIsRoute() || kpInboxIsEditableTarget(event.target)) return;
    if (key === "?" || ((event.metaKey || event.ctrlKey) && key === "/")) {
      event.preventDefault();
      kpInboxToggleHelp();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (key === "j" || key === "k") {
      event.preventDefault();
      kpInboxMove(key === "j" ? 1 : -1);
      return;
    }
    if (key === "e") {
      event.preventDefault();
      kpInboxToggleDetail();
      return;
    }
    if ((key === "a" || key === "d") && !event.repeat) {
      event.preventDefault();
      kpInboxArmAction(key === "a" ? "approve" : "reject", key);
    }
    if (key === "x" && !event.repeat) {
      event.preventDefault();
      kpInboxArmAction("defer", "x");
    }
  });

  renderRoute().catch(function () {});
  kpHydrateGateCommentCards(document);
  refreshAttentionBadges();
  setInterval(refreshAttentionBadges, 60000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refreshAttentionBadges();
  });
  // 状态药丸跨路由保鲜:每 10s 刷新极简计数,后台暂停,回前台立刷。
  setInterval(pollPills, 10000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) pollPills(); });
})();
`;
