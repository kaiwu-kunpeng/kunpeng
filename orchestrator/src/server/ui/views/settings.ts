import { DEFAULT_BACKEND_CONFIG } from "../../../agent/backend-config.js";
import { escHtml } from "../../../util/esc-html.js";
import type { DashboardState } from "../../state.js";

const ROUTE_STAGES = ["spec", "design", "implement", "review", "verify", "audit"];

/** 一个可折叠设置分组：点标题（含 ▸/▾ 箭头）展开/收起内容。open 控制初始是否展开。 */
function section(title: string, body: string, hint = "", open = false): string {
  return `
    <div class="acc-sec" data-acc-open="${open ? "1" : "0"}">
      <div class="section-h acc-head" data-action="toggle-section" style="cursor:pointer;user-select:none">
        <span class="acc-caret" style="display:inline-block;width:1em;color:var(--muted)">${open ? "▾" : "▸"}</span>
        <h3 style="display:inline">${escHtml(title)}</h3>
        ${hint ? `<span class="hint">${escHtml(hint)}</span>` : ""}
      </div>
      <div class="runs acc-body"${open ? "" : ' style="display:none"'}>
        ${body}
      </div>
    </div>
  `;
}

// ── 账号 ───────────────────────────────────────────────────────────
// 账号列表由 client.ts 通过 GET /api/accounts 异步填充进 #acctList。
function renderAccounts(): string {
  return `
    <div class="runs" id="acctList" style="margin-bottom:10px">
      <div class="run"><span class="name muted">加载中…</span></div>
    </div>
    <div class="run" id="acctEditBox" data-edit-original="" style="display:none;flex-direction:column;align-items:stretch;gap:8px;max-width:560px;border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:10px">
      <div class="muted" style="font-size:12px">编辑账号 <b id="acctEditName"></b>。改用户名 / 切角色 / 改 profile；新密码留空则不改。</div>
      <input class="ipt" data-edit="username" placeholder="用户名">
      <select class="sel" data-edit="role">
        <option value="member">member（成员，受限）</option>
        <option value="owner">owner（管理员）</option>
      </select>
      <input class="ipt" data-edit="profileId" placeholder="profile（项目隔离标识）">
      <input class="ipt" type="password" data-edit="newPassword" placeholder="重置密码（留空不改）">
      <div class="run" style="gap:8px">
        <button class="b pri" data-action="save-edit-account">保存修改</button>
        <button class="b" data-action="cancel-edit-account">取消</button>
      </div>
    </div>
    <div class="run" style="flex-direction:column;align-items:stretch;gap:8px;max-width:560px">
      <div class="muted" style="font-size:12px">添加 Web 用户（仅 owner 可操作）。member 只能访问分配的 profile，owner 可管理账号。</div>
      <input class="ipt" data-acct="username" placeholder="用户名">
      <input class="ipt" type="password" data-acct="password" placeholder="初始密码(至少8位)">
      <select class="sel" data-acct="role">
        <option value="member">member（成员，受限）</option>
        <option value="owner">owner（管理员）</option>
      </select>
      <input class="ipt" data-acct="profileId" value="home" placeholder="profile（项目隔离标识，默认 home）">
      <button class="b pri" data-action="add-account" style="align-self:flex-start">添加账号</button>
    </div>
  `;
}

function renderPasswordChange(): string {
  return `
    <div class="run" style="flex-direction:column;align-items:stretch;gap:8px;max-width:560px">
      <input class="ipt" type="password" data-field="currentPassword" placeholder="当前密码">
      <input class="ipt" type="password" data-field="newPassword" placeholder="新密码(至少8位)">
      <input class="ipt" type="password" data-field="confirmPassword" placeholder="确认新密码">
      <button class="b pri" data-action="change-password" style="align-self:flex-start">修改我的密码</button>
    </div>
  `;
}

// ── 通讯 ───────────────────────────────────────────────────────────
function renderNotify(): string {
  return `
    <div class="run" style="flex-direction:column;align-items:stretch;gap:8px;max-width:600px">
      <div class="muted" style="font-size:12px;line-height:1.7">合并门出现时推到手机，点链接即可远程批准。填哪路推哪路，留空不推。个人微信推荐 WxPusher（无日限）或 Server酱（免费 5 条/天）；Telegram 还能在聊天里直接批。</div>
      <input class="ipt" data-nf="cockpitUrl" placeholder="cockpit 地址（如 https://cockpit.example.com，用于推送里的审批链接）">
      <input class="ipt" type="password" data-nf="tgToken" placeholder="Telegram bot token（@BotFather 获取，需与 chat_id 成对填）">
      <input class="ipt" data-nf="tgChat" placeholder="Telegram chat_id（需与 bot token 成对填）">
      <input class="ipt" type="password" data-nf="wxToken" placeholder="WxPusher appToken（个人微信，无日限，推荐）">
      <input class="ipt" data-nf="wxUid" placeholder="WxPusher UID（需与 appToken 成对填）">
      <input class="ipt" type="password" data-nf="serverChan" placeholder="Server酱 sendkey（个人微信，免费 5 条/天）">
      <input class="ipt" type="password" data-nf="wecom" placeholder="企业微信群机器人 webhook">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="b pri" data-action="save-notify">保存通讯设置</button>
        <button class="b" data-action="test-notify">发送测试</button>
      </div>
      <div class="muted" data-nf-result role="status" aria-live="polite"></div>
    </div>
  `;
}

// ── 后端 & 配额 ────────────────────────────────────────────────────
function renderRouting(state: DashboardState): string {
  const routing = state.backendConfig?.routing ?? DEFAULT_BACKEND_CONFIG.routing;
  const enabled = state.backendConfig?.enabled ?? ["claude", "codex"];
  const rows = ROUTE_STAGES.map((stage) => {
    const backend = routing[stage] ?? DEFAULT_BACKEND_CONFIG.routing[stage] ?? "-";
    const options = enabled.map((name) => `
          <option value="${escHtml(name)}"${name === backend ? " selected" : ""}>${escHtml(name)}</option>
        `).join("");
    return `
      <div class="run">
        <span class="tag">${escHtml(stage)}</span>
        <span class="muted">→</span>
        <select class="sel" data-stage="${escHtml(stage)}">
          ${options}
        </select>
      </div>
    `;
  }).join("");
  return `${rows}
      <div class="run">
        <button class="b pri" data-action="save-backends">保存后端路由</button>
      </div>
  `;
}

/** 只读状态：启用后端 + 各账号配额 + 按后端用量，合并为一个面板，明确标「只读」。 */
function renderStatusPanel(state: DashboardState): string {
  const enabled = state.backendConfig?.enabled?.length
    ? state.backendConfig.enabled.join(" / ")
    : "-";
  const enabledRow = `
    <div class="run">
      <span class="tag">启用后端</span>
      <span class="name">${escHtml(enabled)}</span>
    </div>
  `;

  const quota = state.quota;
  const health = state.backendHealth;
  const healthRows = health ? `
    <div class="run"><span class="tag">生效链</span><span class="name">${escHtml(health.chain.join(" → ") || "-")}</span></div>
    ${health.down.map(({ backend, kind, until, reason }) => `
      <div class="run"><span class="tag">下线</span><span class="name">${escHtml(`${backend}（${kind}，至 ${new Date(until).toTimeString().slice(0, 5)}）· ${reason}`)}</span></div>
    `).join("")}
    ${health.modelsDown.map(({ backend, model, kind, until }) => `
      <div class="run"><span class="tag">模型下线</span><span class="name">${escHtml(`${backend}:${model}（${kind}，至 ${new Date(until).toTimeString().slice(0, 5)}）`)}</span></div>
    `).join("")}
    ${!health.down.length && !health.modelsDown.length ? '<div class="run"><span class="tag">下线</span><span class="name muted">无</span></div>' : ""}
  ` : "";
  const quotaRows = quota && quota.accounts.length
    ? quota.accounts.map((account) => {
        const limit = account.limit === undefined ? "∞" : account.limit;
        const health = account.health
          ? `<span class="name">${escHtml(account.health.ok ? "健康通过" : "健康未通过")}${!account.health.ok && account.health.reason ? ` · ${escHtml(account.health.reason)}` : ""}</span>`
          : "";
        return `
          <div class="run">
            <span class="tag">配额 ${escHtml(account.id)}</span>
            <span class="name">${escHtml(account.used)} / ${escHtml(limit)}</span>
            ${health}
          </div>
        `;
      }).join("") + `
        <div class="run">
          <span class="tag">配额合计</span>
          <span class="name">${escHtml(quota.total)}</span>
        </div>
      `
    : `<div class="run"><span class="tag">配额</span><span class="name muted">暂无数据</span></div>`;

  const usageEntries = Object.entries(state.costSummary?.tokensByBackend ?? {});
  const usageRows = usageEntries.length
    ? usageEntries.map(([backend, tokens]) => `
        <div class="run">
          <span class="tag">用量 ${escHtml(backend)}</span>
          <span class="name">${escHtml(tokens)}</span>
        </div>
      `).join("")
    : `<div class="run"><span class="tag">用量</span><span class="name muted">-</span></div>`;

  return `${enabledRow}${healthRows}${quotaRows}${usageRows}`;
}

// ── 异地工作机 ────────────────────────────────────────────────────
function renderWorkerMachines(): string {
  return `
    <div class="run">
      <button class="b pri" id="kp-worker-mint" data-kp-worker-action="mint">签发工作机 token</button>
      <button class="b" data-kp-worker-action="refresh">刷新在线工作机</button>
      <span class="hint">工作机名称与工作目录来自远端，仅作展示。</span>
    </div>
    <div class="run">
      <span class="tag">工作机 token</span>
      <code class="name" id="kp-worker-token">尚未签发</code>
    </div>
    <div id="kp-worker-machines">
      <div class="run empty"><span class="name muted">加载中…</span></div>
    </div>
    <div class="run">
      <span class="tag">已吊销</span>
      <span class="hint">吊销后原 token 失效；解除后可重新接入。</span>
    </div>
    <div id="kp-worker-revoked">
      <div class="run empty"><span class="name muted">加载中…</span></div>
    </div>
    <div class="run">
      <span class="tag">接入命令</span>
      <code class="name" id="kp-worker-cmd">正在生成…</code>
      <button class="b" data-kp-worker-action="copy-command">复制命令</button>
    </div>
  `;
}

// ── 偏好 ───────────────────────────────────────────────────────────
function renderAppearance(): string {
  return `
    <div class="run">
      <span class="tag">主题</span>
      <button class="b" data-theme-set="light">白天</button>
      <button class="b" data-theme-set="dark">夜间</button>
    </div>
  `;
}

export function renderSettings(state: DashboardState): string {
  return `
    <div class="section-h">
      <h3>设置</h3>
      <span class="hint">账号 · 通讯 · 后端 · 偏好</span>
    </div>
    ${section("账号", renderAccounts() + renderPasswordChange(), "", true)}
    ${section("通讯 / 远程批门", renderNotify())}
    ${section("后端路由", renderRouting(state))}
    ${section("运行状态", renderStatusPanel(state), "只读")}
    ${section("异地工作机", renderWorkerMachines(), "出差模式")}
    ${section("偏好", renderAppearance())}
  `;
}
