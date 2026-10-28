import { escHtml } from "../../../util/esc-html.js";
import type { DashboardState } from "../../state.js";
import { renderEmptyState } from "../empty-state.js";
import { clip, relTime, stripMd } from "../fmt.js";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function signedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${pct(value)}`;
}

function fmtHours(h: number | undefined): string {
  if (h === undefined || !Number.isFinite(h)) return "—";
  return (Math.round(h * 10) / 10).toString();
}

function fmtTokens(n: number | undefined): string {
  if (!n || !Number.isFinite(n)) return "0";
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

function cleanText(value: unknown, max = 90): string {
  return clip(stripMd(String(value ?? "")), max);
}

function epochMs(value: unknown): number | undefined {
  const n = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (Number.isFinite(n)) return n < 10_000_000_000 ? n * 1000 : n;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function relTimeValue(value: unknown): string {
  const ms = epochMs(value);
  return ms === undefined ? "" : relTime(ms);
}

function cleanRunText(value: unknown): string {
  return cleanText(value, 120).replace(/@\s*(\d{10,13})\b/g, (_match, digits: string) => {
    const label = relTimeValue(digits);
    return label ? `· ${label}` : "";
  }).replace(/\s+/g, " ").trim();
}

function proposalTime(p: NonNullable<DashboardState["evolution"]>["proposals"][number]): string {
  const timed = p as typeof p & { at?: unknown; updatedAt?: unknown; createdAt?: unknown; timestamp?: unknown };
  return relTimeValue(timed.at ?? timed.updatedAt ?? timed.createdAt ?? timed.timestamp);
}

// 通道元数据：label/副标题/颜色变量/图标。颜色只走 var(--ch-*)（theme.ts 双皮定义），视图不硬编码 channel 色。
const CHANNEL_META: Record<string, { label: string; sub: string; cc: string; icon: string }> = {
  ears: { label: "耳朵", sub: "ears · 失败→研究", cc: "--ch-ears", icon: `<path d="M6 9a6 6 0 0112 0c0 4-3 5-3 8a3 3 0 11-6 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` },
  official: { label: "官方", sub: "official · changelog", cc: "--ch-official", icon: `<path d="M4 5h16v11H4z M8 20h8 M12 16v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` },
  module: { label: "模块", sub: "module · 逐模块巡检", cc: "--ch-module", icon: `<path d="M4 7l8-4 8 4v10l-8 4-8-4z M4 7l8 4 8-4 M12 11v10" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>` },
  security: { label: "安全", sub: "security · npm audit", cc: "--ch-security", icon: `<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>` },
};
const CHANNEL_ORDER = ["ears", "official", "module", "security"];

const SPARK = `<svg class="chan-spark" width="100%" height="26" viewBox="0 0 200 26" preserveAspectRatio="none"><path d="M2,18 L30,16 L58,14 L86,15 L114,11 L142,12 L170,8 L198,7" fill="none" stroke="var(--cc)" stroke-width="2" stroke-linecap="round"/></svg>`;

function renderChannelTiles(evolution: NonNullable<DashboardState["evolution"]>): string {
  const counts = new Map((evolution.channels ?? []).map((c) => [c.channel, c]));
  return CHANNEL_ORDER.map((key) => {
    const meta = CHANNEL_META[key];
    const summary = counts.get(key);
    const count = summary?.count ?? 0;
    const dotClass = count > 0 ? "live live-dot" : "ok";
    const foot = count > 0 ? `live · ${count} 待消化` : "ok · 无新发现";
    return `
          <section class="tile chan c3" style="--cc:var(${meta.cc})">
            <div class="ch-head">
              <span class="ch-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none">${meta.icon}</svg></span>
              <span class="ch-name">${escHtml(meta.label)} <small>${escHtml(meta.sub)}</small></span>
              <span class="fdot ${dotClass}"></span>
            </div>
            <div class="ch-count">◆ ${count} <span class="tr" style="color:var(--muted)">${count > 0 ? "▲" : "–"}</span></div>
            ${SPARK}
            <div class="ch-foot"><span class="ld"></span>${escHtml(foot)}</div>
          </section>`;
  }).join("");
}

function evidenceChip(p: NonNullable<DashboardState["evolution"]>["proposals"][number]): string {
  const state = p.evidenceState ?? (p.hasEvidence ? "tested" : "untested");
  if (state === "tested") return `<span class="chip tested">✓ tested</span>`;
  if (state === "downgraded") return `<span class="chip downgraded">▾ downgraded</span>`;
  return `<span class="chip untested">○ untested</span>`;
}

function renderProposalRows(evolution: NonNullable<DashboardState["evolution"]>): string {
  if (evolution.proposals.length === 0) {
    return renderEmptyState({
      title: "没有待审提案",
      hint: "巡检每日自动跑，有发现会出现在这里",
    });
  }
  return evolution.proposals.map((p) => {
    const ch = p.channel && CHANNEL_META[p.channel] ? CHANNEL_META[p.channel].cc : "--muted";
    const summary = cleanText(p.summary) || "(无摘要)";
    const time = proposalTime(p);
    const timeChip = time ? `<span class="chip">${escHtml(time)}</span>` : "";
    const deltaChip = p.delta !== undefined
      ? `<span class="chip metric ${p.delta >= 0 ? "pos" : "neg"}">Δ ${signedPct(p.delta)}</span>`
      : "";
    const gate = p.hasEvidence
      ? `<span class="gdot pass"><span class="d"></span>门 pass</span>`
      : `<span class="gdot"><span class="d"></span>门 待测</span>`;
    // 保留功能钩子：有证据的提案给「差分报告」按钮（data-action=eval-report），SPA 与 evolution-merge 测试依赖。
    const evalBtn = p.hasEvidence
      ? `<button class="btn-more" data-action="eval-report" data-id="${escHtml(p.id)}" title="差分报告">⊘</button>`
      : `<button class="btn-more">⋯</button>`;
    return `
              <div class="prow" data-proposal="${escHtml(p.id)}" style="--cc:var(${ch})">
                <div class="acc"></div>
                <div class="mid">
                  <span class="pid">${escHtml(p.id)}</span>
                  <div class="psum">${escHtml(summary)}</div>
                  <div class="chips">
                    ${evidenceChip(p)}
                    ${timeChip}
                    ${deltaChip}
                    ${gate}
                  </div>
                </div>
                <div class="right">
                  <button class="btn-appr" data-action="approve-apply" data-id="${escHtml(p.id)}"${p.evidenceState === "downgraded" ? ' style="opacity:.5;pointer-events:none"' : ""}>批准</button>
                  ${evalBtn}
                </div>
              </div>`;
  }).join("");
}

function renderFitness(evolution: NonNullable<DashboardState["evolution"]>): string {
  const d = evolution.dashboard;
  const cand = d?.holdoutPassAt1;
  const delta = d?.lastDelta ?? 0;
  if (cand === undefined) {
    return `
          <section class="tile c4">
            <p class="tlabel">适应度 · 最新候选 vs 基线</p>
            <div class="empty-note">暂无评测证据 · 候选过测试门后回填（净省工时 ↑ ∧ 非回归）</div>
          </section>`;
  }
  const base = Math.max(0, cand - delta);
  const candW = Math.min(100, Math.round(cand * 100));
  const baseLeft = Math.min(100, Math.round(base * 100));
  return `
          <section class="tile c4">
            <p class="tlabel">适应度 · 最新候选 vs 基线</p>
            <div class="fit-row">
              <span class="fit-base">baseline <b>${escHtml(pct(base))}</b></span>
              <span class="fit-base">candidate <b style="color:var(--primary)">${escHtml(pct(cand))}</b></span>
            </div>
            <div class="bullet">
              <div class="cand" style="width:${candW}%"></div>
              <span class="tick" style="left:${baseLeft}%"></span>
            </div>
            <div class="fit-deltas">
              <span class="chip metric ${delta >= 0 ? "pos" : "neg"}">pass@1 Δ ${signedPct(delta)}</span>
              <span class="chip ${delta > 0 ? "tested" : "untested"}">${delta > 0 ? "✓ 门 放行" : "✗ 门 拦截"}</span>
            </div>
            <p class="fit-note">真适应度 = 净省工时 ↑ ∧ 成本不恶化 ∧ 非回归（holdout 冻结防刷分）</p>
          </section>`;
}

function renderHealth(state: DashboardState, evolution: NonNullable<DashboardState["evolution"]>): string {
  const d = evolution.dashboard;
  const passAt1 = d?.holdoutPassAt1 !== undefined ? pct(d.holdoutPassAt1) : "—";
  const net = `${fmtHours(state.savings?.netSavedHours)}h`;
  const token = fmtTokens(state.costSummary?.totalTokens);
  const archive = String(d?.archiveSize ?? 0);
  const epoch = `#${d?.holdoutEpoch ?? 0}`;
  const cells: [string, string][] = [
    [passAt1, "pass@1"],
    [archive, "进化尝试"],
    [net, "net 净省"],
    [token, "token"],
    [epoch, "holdout"],
  ];
  const grid = cells.map(([n, l]) => `
              <div class="hm">
                <div class="hm-n">${escHtml(n)}</div>
                <div class="hm-l">${escHtml(l)}</div>
                <svg width="100%" height="20" viewBox="0 0 50 20" preserveAspectRatio="none"><path d="M1,15 L12,13 L25,11 L38,8 L49,5" fill="none" stroke="var(--primary)" stroke-width="1.8" stroke-linecap="round"/></svg>
              </div>`).join("");
  return `
          <section class="tile c4" data-panel="evo-dashboard">
            <p class="tlabel">健康 · 多指标</p>
            <div class="hm-grid">${grid}</div>
            <div class="hm-cap"><span class="shield">⛨</span> 多指标 · pass@1 是 gold 门、Δ&gt;0 才放行、holdout 冻结不参与优化（防 reward-hack 刷分）</div>
          </section>`;
}

function renderUpgradeActivity(evolution: NonNullable<DashboardState["evolution"]>): string {
  const ups = (evolution.upgrades ?? []).slice(0, 5);
  const items = ups.length
    ? ups.map((u) => `
              <div class="tl-item appr" style="--cc:var(--success)">
                <div class="tl-txt"><b>applied</b> <span class="code">${escHtml(u.id)}</span> · ${escHtml(cleanText(u.changes.map((c) => c.text).join(" ; ") || u.summary, 48))}</div>
                <div class="tl-time">${u.holdoutPassK !== undefined ? `holdout ${Math.round(u.holdoutPassK * 100)}%` : "已应用"} · 人工门 #2</div>
              </div>`).join("")
    : `<div class="tl-item"><div class="tl-txt" style="color:var(--muted)">暂无升级记录</div></div>`;
  return `
          <section class="tile c4 row-tall">
            <p class="tlabel">活动 · Activity</p>
            <div class="tl-day">${escHtml(cleanRunText(evolution.lastRunText))}</div>
            <div class="tl">${items}</div>
          </section>`;
}

// 谱系 / 权衡 / 记忆：E1/E3 接线后启用，当前给结构占位 + 诚实标注，不假装有数据。
function renderLineagePlaceholder(): string {
  return `
          <section class="tile c4">
            <p class="tlabel">谱系档案 · Lineage</p>
            <div class="empty-note">变体档案 + 胜出脊线（DGM 式踏脚石）· <b>待 E3 接线</b></div>
          </section>
          <section class="tile c4">
            <p class="tlabel">最优权衡 · Pareto</p>
            <div class="empty-note">净省工时 × 成本 前沿（被支配点保留灰显）· <b>待 E3 接线</b></div>
          </section>
          <section class="tile c4">
            <p class="tlabel">复利记忆 · Memory</p>
            <div class="empty-note">蒸馏 · 可复用 · 带 provenance 与衰减的经验单元 · <b>待 E1 接线</b></div>
          </section>`;
}

export function renderEvolution(state: DashboardState): string {
  const evolution = state.evolution;

  if (!evolution) {
    return `
      <div class="body">
        <div class="wrap">
          <div class="evo-bento">
            <div class="bento">
              <section class="tile c12"><p class="tlabel">自进化 · Self-Evolution</p><div class="empty-note">暂无自进化数据。<a href="#/inbox">去待我处理审批</a></div></section>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const netSaved = fmtHours(state.savings?.netSavedHours);
  const token = fmtTokens(state.costSummary?.totalTokens);
  const queue = evolution.pendingCount;
  const archive = evolution.dashboard?.archiveSize ?? 0;
  const gatePass = (evolution.dashboard?.lastDelta ?? 0) >= 0;

  return `
    <div class="body">
      <div class="wrap">
        <div class="evo-bento">
          <div class="bento">

            <section class="tile big hero-tile c5 row-tall">
              <p class="tlabel"><span class="star">★</span> 净省工时 · North Star</p>
              <div class="hero-num">${escHtml(netSaved)}<span class="u">h</span></div>
              <span class="delta up">真适应度内核（净省工时 ∧ 成本 ∧ 非回归）</span>
              <div class="hero-spark">
                <svg width="100%" height="78" viewBox="0 0 460 78" preserveAspectRatio="none">
                  <defs><linearGradient id="evoHeroFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--primary)" stop-opacity="0.22"/><stop offset="100%" stop-color="var(--primary)" stop-opacity="0"/></linearGradient></defs>
                  <path d="M0,62 L66,58 L131,52 L197,49 L263,38 L329,32 L394,22 L460,12 L460,78 L0,78 Z" fill="url(#evoHeroFill)"/>
                  <path d="M0,62 L66,58 L131,52 L197,49 L263,38 L329,32 L394,22 L460,12" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <circle cx="460" cy="12" r="4.5" fill="var(--primary)" stroke="var(--card)" stroke-width="2"/>
                </svg>
              </div>
              <p class="hero-def">净省工时 = 人工估时 − loop 实际，仅计 <code>verified</code> dev flow。${escHtml(cleanRunText(evolution.lastRunText))}。</p>
            </section>

            <section class="tile kpi c2">
              <p class="tlabel" style="margin:0">Token 用量</p>
              <div class="kp-num">${escHtml(token)}</div>
              <div class="kp-cap" style="margin-top:5px">累计 token</div>
            </section>

            <section class="tile kpi c2">
              <p class="tlabel" style="margin:0">门 · Gate #2</p>
              <div class="kp-num" style="color:var(${gatePass ? "--success" : "--warn"})">${gatePass ? "● pass" : "● 待审"}</div>
              <div class="kp-cap" style="margin-top:5px">Δ&gt;0 才放行</div>
            </section>

            <section class="tile kpi c2">
              <p class="tlabel" style="margin:0">待审 · Queue</p>
              <div class="kp-num">▴ ${queue}</div>
              <div class="kp-cap" style="margin-top:5px">等待人工门${evolution.approvedCount > 0 ? ` · <b style="color:var(--warn)">${evolution.approvedCount} 已批未落地</b>（下次 maintain 自动应用或 kunpeng apply）` : ""}</div>
            </section>

            <section class="tile kpi c3">
              <p class="tlabel" style="margin:0">进化尝试 · Archive</p>
              <div class="kp-num">${archive}</div>
              <div class="kp-cap" style="margin-top:5px">变体 · 谱系</div>
            </section>

            ${renderChannelTiles(evolution)}

            <section class="tile c8" data-panel="proposals">
              <p class="tlabel">待审提案 · 人工门 #2 <span class="badge">${queue} 待审</span></p>
              <div class="prop-list">
                ${renderProposalRows(evolution)}
              </div>
              <div class="prop-foot"><a href="#/inbox">去待我处理审批 →</a></div>
            </section>

            ${renderUpgradeActivity(evolution)}

            ${renderFitness(evolution)}

            ${renderHealth(state, evolution)}

            ${renderLineagePlaceholder()}

          </div>
        </div>
      </div>
    </div>
  `;
}
