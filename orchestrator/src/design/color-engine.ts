import { apcaLc } from "./apca.js";

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

export interface SemanticTokens {
  [name: string]: string;
}

type Rgb = { r: number; g: number; b: number };

const LIGHT_L_STOPS = [0.985, 0.96, 0.925, 0.875, 0.805, 0.72, 0.625, 0.53, 0.455, 0.37, 0.295, 0.22];
const CHROMA_WEIGHTS = [0.08, 0.14, 0.23, 0.34, 0.48, 0.64, 0.78, 0.92, 1, 0.86, 0.68, 0.48];
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function normalizeHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

function parseHex(hex: string): Rgb {
  const s = hex.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(s);
  if (short) {
    const [r, g, b] = short[1].split("").map((ch) => Number.parseInt(ch + ch, 16) / 255);
    return { r, g, b };
  }

  const long = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (long) {
    return {
      r: Number.parseInt(long[1].slice(0, 2), 16) / 255,
      g: Number.parseInt(long[1].slice(2, 4), 16) / 255,
      b: Number.parseInt(long[1].slice(4, 6), 16) / 255,
    };
  }

  throw new Error(`Invalid hex color: ${hex}`);
}

function toHexByte(n: number): string {
  return Math.round(clamp(n, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0");
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function srgbToLinear(u: number): number {
  return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
}

function linearToSrgb(u: number): number {
  return u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055;
}

export function hexToOklch(hex: string): Oklch {
  const srgb = parseHex(hex);
  const r = srgbToLinear(srgb.r);
  const g = srgbToLinear(srgb.g);
  const b = srgbToLinear(srgb.b);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  const labL = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const labA = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const labB = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;

  return {
    l: labL,
    c: Math.hypot(labA, labB),
    h: normalizeHue((Math.atan2(labB, labA) * 180) / Math.PI),
  };
}

export function oklchToHex(col: Oklch): string {
  const hue = (normalizeHue(col.h) * Math.PI) / 180;
  const chroma = Math.max(0, col.c);
  const labL = clamp(col.l, 0, 1);
  const labA = chroma * Math.cos(hue);
  const labB = chroma * Math.sin(hue);

  const lRoot = labL + 0.3963377774 * labA + 0.2158037573 * labB;
  const mRoot = labL - 0.1055613458 * labA - 0.0638541728 * labB;
  const sRoot = labL - 0.0894841775 * labA - 1.291485548 * labB;

  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const s = sRoot * sRoot * sRoot;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return rgbToHex({ r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b) });
}

export function relLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(fgHex: string, bgHex: string): number {
  const fg = relLuminance(fgHex);
  const bg = relLuminance(bgHex);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

export function solveFg(bgHex: string, target = 60): string {
  const bg = hexToOklch(bgHex);
  const bgLum = relLuminance(bgHex);
  const searchDark = bgLum >= 0.18;
  const c = clamp(bg.c, 0, 0.08);
  let apcaFallback = "";

  for (let i = 0; i <= 100; i += 1) {
    const t = i / 100;
    const l = searchDark ? 0.2 + (bg.l - 0.2) * t : 0.97 - (0.97 - bg.l) * t;
    const candidate = oklchToHex({ l, c: c * t, h: bg.h });
    if (Math.abs(apcaLc(candidate, bgHex)) >= target) {
      apcaFallback ||= candidate;
      if (contrastRatio(candidate, bgHex) >= 4.5) {
        return candidate;
      }
    }
  }

  if (apcaFallback) {
    return apcaFallback;
  }

  const nearBlack = oklchToHex({ l: 0.2, c: 0, h: bg.h });
  const nearWhite = oklchToHex({ l: 0.97, c: 0, h: bg.h });
  const nearBlackLc = Math.abs(apcaLc(nearBlack, bgHex));
  const nearWhiteLc = Math.abs(apcaLc(nearWhite, bgHex));
  return nearBlackLc >= nearWhiteLc ? nearBlack : nearWhite;
}

export function buildScale(seedHex: string): { light: string[]; dark: string[] } {
  const seed = hexToOklch(seedHex);
  const baseC = clamp(seed.c, 0.035, 0.18);
  const light = LIGHT_L_STOPS.map((l, index) =>
    oklchToHex({
      l,
      c: baseC * CHROMA_WEIGHTS[index],
      h: seed.h,
    }),
  );

  return { light, dark: [...light].reverse() };
}

function buildModeSemantic(scale: string[]): SemanticTokens {
  const background = scale[0];
  const card = scale[1];
  const muted = scale[2];
  const secondary = scale[3];
  const border = scale[5];
  const input = scale[5];
  const ring = scale[7];
  const primary = scale[8];
  const p = hexToOklch(primary);
  const accent = oklchToHex({
    l: 0.76,
    c: Math.min(0.16, Math.max(0.10, p.c)),
    h: (p.h + 180) % 360,
  });

  return {
    background,
    foreground: solveFg(background),
    card,
    "card-foreground": solveFg(card),
    primary,
    "primary-foreground": solveFg(primary),
    secondary,
    muted,
    "muted-foreground": solveFg(muted),
    accent,
    "accent-foreground": solveFg(accent),
    border,
    input,
    ring,
  };
}

export function buildSemantic(scale: { light: string[]; dark: string[] }): { light: SemanticTokens; dark: SemanticTokens } {
  return {
    light: buildModeSemantic(scale.light),
    dark: buildModeSemantic(scale.dark),
  };
}

export function toDTCG(semantic: { light: SemanticTokens; dark: SemanticTokens }): Record<string, unknown> {
  const convert = (tokens: SemanticTokens): Record<string, { $type: "color"; $value: string }> => {
    const out: Record<string, { $type: "color"; $value: string }> = {};
    for (const key of Object.keys(tokens)) {
      out[key] = { $type: "color", $value: tokens[key] };
    }
    return out;
  };

  return {
    light: convert(semantic.light),
    dark: convert(semantic.dark),
  };
}
