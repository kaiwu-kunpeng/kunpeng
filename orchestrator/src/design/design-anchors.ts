// 8 个美学锚:每锚把字体/圆角/动效/材质/色度策略锁死。零依赖纯数据。
export type Chroma = "muted" | "balanced" | "vivid";

export interface StyleAnchor {
  name: string;
  desc: string;
  chroma: Chroma;
  hueBias?: number;
  fontPair: { display: string; body: string; mono?: string };
  radius: number;
  motionMs: number;
  material: string;
}

export const ANCHORS: Record<string, StyleAnchor> = {
  Swiss: {
    name: "Swiss",
    desc: "国际主义网格、克制、留白充足",
    chroma: "muted",
    fontPair: { display: "Inter Tight", body: "Inter", mono: "IBM Plex Mono" },
    radius: 4,
    motionMs: 180,
    material: "flat, strict grid, generous whitespace, hairline dividers",
  },
  Industrial: {
    name: "Industrial",
    desc: "工业仪表、密集数据、功能优先",
    chroma: "balanced",
    fontPair: { display: "Archivo", body: "Archivo", mono: "JetBrains Mono" },
    radius: 2,
    motionMs: 160,
    material: "dense data, technical labels, metal-cool neutrals",
  },
  Brutalist: {
    name: "Brutalist",
    desc: "粗野、原色、硬阴影无模糊",
    chroma: "vivid",
    fontPair: { display: "Space Grotesk", body: "Space Mono" },
    radius: 0,
    motionMs: 120,
    material: "raw, primary colors, hard offset shadows, no blur",
  },
  Aurora: {
    name: "Aurora",
    desc: "极光柔光、层次渐变(非紫蓝)、沉浸",
    chroma: "vivid",
    fontPair: { display: "Clash Display", body: "Manrope" },
    radius: 24,
    motionMs: 300,
    material: "soft ambient glows (avoid purple-blue), layered depth",
  },
  Chaotic: {
    name: "Chaotic",
    desc: "极繁、对撞、信息密度高",
    chroma: "vivid",
    fontPair: { display: "Anton", body: "Work Sans" },
    radius: 12,
    motionMs: 220,
    material: "maximalist collage, bold contrast, busy but intentional",
  },
  "Retro-Futuristic": {
    name: "Retro-Futuristic",
    desc: "复古未来、霓虹克制、网格地平线",
    chroma: "vivid",
    fontPair: { display: "Orbitron", body: "Rajdhani", mono: "Share Tech Mono" },
    radius: 8,
    motionMs: 240,
    material: "retro-future, restrained neon accents, grid horizon",
  },
  Organic: {
    name: "Organic",
    desc: "有机、土色、温暖、颗粒",
    chroma: "muted",
    fontPair: { display: "Fraunces", body: "Inter" },
    radius: 20,
    motionMs: 300,
    material: "earthy sage/clay/terracotta, 1-3% grain, soft curves",
  },
  "Lo-Fi": {
    name: "Lo-Fi",
    desc: "低保真、纸感、安静、复古印刷",
    chroma: "muted",
    fontPair: { display: "Newsreader", body: "Inter" },
    radius: 6,
    motionMs: 200,
    material: "paper texture, muted ink, quiet vintage print",
  },
};

export function anchorNames(): string[] {
  return Object.keys(ANCHORS);
}

export function getAnchor(name: string): StyleAnchor | undefined {
  const normalized = name.toLocaleLowerCase();
  return Object.values(ANCHORS).find((anchor) => anchor.name.toLocaleLowerCase() === normalized);
}

export function describeAnchor(a: StyleAnchor): string {
  return `风格锚 ${a.name}:字体 ${a.fontPair.display} / ${a.fontPair.body};圆角 ${a.radius}px;动效 ${a.motionMs}ms;材质 ${a.material};锁定此锚,禁与其它锚混搭。`;
}
