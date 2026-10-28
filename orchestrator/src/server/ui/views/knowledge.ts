import { escHtml } from "../../../util/esc-html.js";
import type { DashboardState } from "../../state.js";
import { renderEmptyState } from "../empty-state.js";
import { clip, relTime, stripMd } from "../fmt.js";

interface KnowledgeTextInput {
  title?: unknown;
  summary?: unknown;
  citedFrom?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  at?: unknown;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function imageUrlFromMd(value: string): string {
  return /!\[[^\]]*]\(([^)]+)\)/.exec(value)?.[1] ?? "";
}

function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
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

export function cleanKnowledgeText(value: unknown): string {
  return clip(stripMd(String(value ?? "")), 90);
}

function cleanKnowledgeTitle(input: KnowledgeTextInput): string {
  const raw = firstString(input.title, input.summary);
  const cleaned = cleanKnowledgeText(raw);
  if (cleaned) return cleaned;

  const host = hostFromUrl(firstString(input.citedFrom, imageUrlFromMd(raw)));
  if (host) return `(图片) ${host}`;

  const fallback = clip(raw, 40);
  return fallback ? `(图片) ${fallback}` : "(图片)";
}

export function cleanKnowledgeTime(input: KnowledgeTextInput): string {
  const ms = epochMs(input.updatedAt ?? input.createdAt ?? input.at);
  return ms === undefined ? "" : relTime(ms);
}

export function renderKnowledge(state: DashboardState): string {
  void state;
  const loadingTitle = cleanKnowledgeTitle({ title: "加载中…" });

  return `
    <div class="body">
      <div class="wrap">
        <div class="section-h">
          <h3>${escHtml("知识库")}</h3>
          <span class="hint">${escHtml("捕获 · 检索 · promote")}</span>
        </div>
        <div class="lead"><span>${escHtml("外部材料沉淀的知识卡片，可检索、可 promote 成长期可复用知识")}</span></div>
        <div class="section-h">
          <h3>${escHtml("跨项目知识聚合")}</h3>
          <span class="hint">${escHtml("汇总所有已注册项目的知识卡片")}</span>
        </div>
        <div class="runs" data-panel="kb-aggregate">
          <div class="run">
            <input type="text" class="name" data-kb-query placeholder="可选:过滤关键词…">
            <button class="b pri" data-action="kb-aggregate">聚合查看</button>
          </div>
        </div>
        <div class="section-h">
          <h3>${escHtml("问知识库")}</h3>
          <span class="hint">${escHtml("基于你存的资料回答 · 带来源")}</span>
        </div>
        <div class="runs" data-panel="knowledge-ask">
          <div class="run">
            <input type="text" class="name" data-knowledge-ask-input placeholder="问一个问题，鲲鹏基于你的知识库回答…">
            <button class="b pri" data-action="knowledge-ask">问</button>
          </div>
        </div>
        <div class="runs" id="knowledge-answer" data-panel="knowledge-answer"></div>
        <div class="section-h">
          <h3>${escHtml("主题综述")}</h3>
          <span class="hint">${escHtml("把某主题的卡片综述成带来源的简报,可粘进文档")}</span>
        </div>
        <div class="runs" data-panel="knowledge-synth">
          <div class="run" style="flex-wrap:wrap;gap:8px">
            ${["产品", "技术", "战略", "行业洞察", "运营增长", "工具方法", "其他"].map((category) => `<button class="b" data-action="knowledge-synth" data-category="${escHtml(category)}">${escHtml(category)}</button>`).join("")}
          </div>
        </div>
        <div class="runs" id="knowledge-synth-out" data-panel="knowledge-synth-out"></div>
        <div class="section-h">
          <h3>${escHtml("温故 · 每日重现")}</h3>
          <span class="hint">${escHtml("每天浮现几张旧卡片,避免收藏吃灰")}</span>
        </div>
        <div class="runs" id="knowledge-resurface" data-panel="knowledge-resurface">
          <div class="run empty"><span class="name">${escHtml(loadingTitle)}</span></div>
        </div>
        <div class="section-h">
          <h3>${escHtml("标签云 · 热门主题")}</h3>
          <span class="hint">${escHtml("点词即检索 · 字号=热度 · 颜色=分类")}</span>
        </div>
        <div class="runs" id="knowledge-tagcloud" data-panel="knowledge-tagcloud">
          <div class="run"><span class="name">${escHtml(loadingTitle)}</span></div>
        </div>
        <div class="section-h">
          <h3>${escHtml("捕获新知识")}</h3>
          <span class="hint">${escHtml("捕获 = 把外部内容（文本/网址）存成可检索的知识卡片")}</span>
        </div>
        <div class="runs" data-panel="knowledge-capture">
          <div class="run">
            <textarea class="name" data-knowledge-capture-input placeholder="贴文本 → 鲲鹏自动摘要 + 提取标签"></textarea>
            <button class="b pri" data-action="knowledge-capture">捕获</button>
          </div>
          <div class="run">
            <input type="text" class="name" data-knowledge-capture-url placeholder="贴网址（支持今日头条 m.toutiao.com 等）">
            <button class="b pri" data-action="knowledge-capture-url">抓取并整理</button>
            <span class="hint">${escHtml("鲲鹏自动抓取正文 → 整理成知识卡片")}</span>
          </div>
        </div>
        <div class="section-h">
          <h3>${escHtml("蒸馏技能")}</h3>
          <span class="hint">${escHtml("从已验证经验一键生成 SKILL.md 草稿")}</span>
        </div>
        <div class="runs" data-panel="knowledge-distill">
          <div class="run">
            <input type="text" class="name" data-distill-name placeholder="技能名称（中/英文）">
            <input type="text" class="name" data-distill-desc placeholder="一句话描述（可选，默认同名称）">
            <button class="b pri" data-action="distill-skill">蒸馏</button>
          </div>
        </div>
        <div class="runs" data-panel="knowledge-search">
          <div class="run">
            <input class="name" type="text" data-knowledge-input placeholder="检索知识卡片">
            <button class="b" data-action="knowledge-search">检索</button>
            <button class="b" data-action="knowledge-clear">清空</button>
          </div>
        </div>
        <div class="runs" id="knowledge-results" data-panel="knowledge">
          ${renderEmptyState({
            title: "知识库还是空的",
            hint: "捕获一段文字或一个 URL 就有第一条",
            actions: [{ label: "捕获新知识", action: "knowledge-capture" }],
          })}
        </div>
      </div>
    </div>
  `;
}
