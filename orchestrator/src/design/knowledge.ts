import { tokenize } from "../knowledge/tokenize.js";

export interface StyleEntry { id: string; name: string; keywords: string; bestFor: string }
export interface ColorPalette { industry: string; primary: string; secondary: string; cta: string; note: string }
export interface FontPair { id: string; serif: string; sans: string; vibe: string }
export interface AntiPattern { id: string; rule: string; why: string }
export interface DesignAdvice { styles: StyleEntry[]; palettes: ColorPalette[]; fonts: FontPair[]; antiPatterns: AntiPattern[] }

const STYLES: StyleEntry[] = [
  { id: "minimal", name: "极简主义 Minimalism", keywords: "minimal clean whitespace 留白 简洁 SaaS 专业", bestFor: "SaaS 工具 后台 专业服务" },
  { id: "glassmorphism", name: "玻璃拟态 Glassmorphism", keywords: "glass blur 毛玻璃 透明 层次 现代", bestFor: "科技 仪表盘 高端展示" },
  { id: "bento", name: "便当格 Bento", keywords: "bento grid 卡片 模块 网格 信息密集", bestFor: "作品集 功能展示 dashboard" },
  { id: "neumorphism", name: "新拟物 Neumorphism", keywords: "soft shadow 柔影 拟物 立体", bestFor: "音乐 健康 轻应用" },
  { id: "brutalism", name: "粗野主义 Brutalism", keywords: "brutalist bold 高对比 大字 边框 个性", bestFor: "创意 媒体 个人品牌" },
  { id: "claymorphism", name: "粘土风 Claymorphism", keywords: "clay 圆润 3d 柔和 友好", bestFor: "教育 儿童 趣味产品" },
  { id: "editorial", name: "杂志编排 Editorial", keywords: "editorial serif 衬线 排版 内容 阅读", bestFor: "内容 博客 媒体 品牌故事" },
  { id: "soft-ui", name: "柔和 UI Soft UI", keywords: "soft 柔粉 优雅 spa 美妆 高端", bestFor: "美妆 水疗 生活方式 奢侈品" },
  { id: "corporate", name: "企业稳健 Corporate", keywords: "corporate 蓝 信任 金融 稳重 专业", bestFor: "金融 银行 企业 法律" },
  { id: "flat", name: "扁平 Flat", keywords: "flat 扁平 通用 清爽", bestFor: "通用 工具 资讯" },
];

const PALETTES: ColorPalette[] = [
  { industry: "SaaS", primary: "#2563eb", secondary: "#0ea5e9", cta: "#f59e0b", note: "蓝系信任+橙CTA,专业不花哨" },
  { industry: "金融银行", primary: "#0f3d3e", secondary: "#1e6f6f", cta: "#c8a24a", note: "深绿/藏蓝+金,稳重;禁紫渐变" },
  { industry: "美妆水疗", primary: "#E8B4B8", secondary: "#A8D5BA", cta: "#D4AF37", note: "柔粉+鼠尾草绿+金;禁霓虹/暗黑" },
  { industry: "医疗健康", primary: "#0891b2", secondary: "#34d399", cta: "#2563eb", note: "青/绿,洁净;禁刺眼动画" },
  { industry: "电商零售", primary: "#db2777", secondary: "#f97316", cta: "#16a34a", note: "活力撞色+绿色下单CTA" },
  { industry: "教育", primary: "#4f46e5", secondary: "#f59e0b", cta: "#10b981", note: "友好明亮,亲和" },
  { industry: "科技AI", primary: "#111827", secondary: "#6366f1", cta: "#22d3ee", note: "深色克制;慎用紫渐变(AI味)" },
  { industry: "内容媒体", primary: "#1f2937", secondary: "#b91c1c", cta: "#f59e0b", note: "黑+红点缀,编辑感" },
];

const FONT_PAIRS: FontPair[] = [
  { id: "elegant", serif: "Cormorant Garamond", sans: "Montserrat", vibe: "优雅 高端 美妆 奢侈" },
  { id: "modern", serif: "Fraunces", sans: "Inter", vibe: "现代 内容 品牌" },
  { id: "tech", serif: "Space Grotesk", sans: "IBM Plex Sans", vibe: "科技 SaaS 极客" },
  { id: "trust", serif: "Lora", sans: "Source Sans 3", vibe: "金融 专业 可读" },
  { id: "friendly", serif: "Bitter", sans: "Nunito", vibe: "教育 友好 亲和" },
];

export const ANTI_PATTERNS: AntiPattern[] = [
  { id: "no-purple-gradient", rule: "禁紫蓝渐变/cyan-on-dark/处处霓虹", why: "AI 生成界面最强指纹,显廉价" },
  { id: "no-emoji-icon", rule: "禁 emoji 当图标,强制 SVG(Heroicons/Lucide)", why: "emoji 跨端不一致、不专业" },
  { id: "no-default-font", rule: "禁默认退回 Inter/Roboto/Arial,必须指定字体配对", why: "默认字体=AI味" },
  { id: "motion-150-300", rule: "动效 150–300ms,禁 0ms 瞬变、禁 >500ms", why: "节奏感来源" },
  { id: "no-card-nesting", rule: "禁卡片套卡片(三层容器)", why: "AI 不懂层级,堆容器" },
  { id: "no-blur-everywhere", rule: "禁无意义全局模糊", why: "为显 modern 滥用 blur" },
  { id: "no-hero-metric-cliche", rule: "禁'大数字+小标签+渐变线'的套路 Hero 指标", why: "90% AI 仪表盘一个样" },
  { id: "copy-no-empower", rule: "文案禁 Empower/Unlock/Transform 开头,至少一处带具体数字", why: "抽象套话=AI味" },
  { id: "a11y-focus", rule: "禁删 focus ring;禁纯 hover 交互;触控≥44px;对比≥WCAG AA", why: "无障碍底线" },
];

function bm25Rank<T>(query: string, items: T[], textOf: (t: T) => string, limit: number): T[] {
  const q = tokenize(query);
  if (q.length === 0) return [];
  const docs = items.map((it) => tokenize(textOf(it)));
  const N = docs.length;
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / (N || 1);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const k1 = 1.5, b = 0.75;
  return items
    .map((it, i) => {
      const d = docs[i];
      let score = 0;
      for (const term of new Set(q)) {
        const tf = d.filter((x) => x === term).length;
        if (!tf) continue;
        const idf = Math.log(1 + (N - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
        score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * d.length / (avgdl || 1)));
      }
      return { it, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, limit)
    .map((x) => x.it);
}

export function searchDesignKnowledge(query: string): DesignAdvice {
  return {
    styles: bm25Rank(query, STYLES, (s) => `${s.name} ${s.keywords} ${s.bestFor}`, 3),
    palettes: bm25Rank(query, PALETTES, (p) => `${p.industry} ${p.note}`, 2),
    fonts: bm25Rank(query, FONT_PAIRS, (f) => `${f.vibe} ${f.serif} ${f.sans}`, 2),
    antiPatterns: ANTI_PATTERNS,
  };
}
