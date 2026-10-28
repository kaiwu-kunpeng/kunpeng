import { isRecord } from "../util/is-record.js";

export interface BrandAssets {
  seedHex?: string;
  fonts: string[];
  logoUrl?: string;
  source?: string;
}

interface ColorCandidate {
  hex: string;
  label?: string;
}

const PRIORITY_COLOR_RE = /(accent|brand|primary)/i;

export function isNeutralHex(hex: string): boolean {
  const normalized = normalizeHex(hex);
  if (normalized === undefined) {
    return false;
  }

  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return Math.max(r, g, b) - Math.min(r, g, b) < 16;
}

export function pickSeedColor(
  colors: Array<{ hex: string; type?: string }> | Record<string, string> | undefined,
): string | undefined {
  const candidates = normalizeColors(colors);
  if (candidates.length === 0) {
    return undefined;
  }

  const priority = candidates.find((candidate) => {
    return candidate.label !== undefined && PRIORITY_COLOR_RE.test(candidate.label);
  });
  if (priority !== undefined) {
    return priority.hex;
  }

  return candidates.find((candidate) => !isNeutralHex(candidate.hex))?.hex ?? candidates[0]?.hex;
}

export function parseBrandResponse(resp: unknown): BrandAssets {
  if (!isRecord(resp)) {
    return { fonts: [] };
  }

  return {
    seedHex: pickSeedColor(readColors(resp.colors)),
    fonts: readFonts(resp.fonts),
    logoUrl: readLogoUrl(resp),
    source: typeof resp.source === "string" ? resp.source : undefined,
  };
}

export interface FetchBrandOpts {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export async function fetchBrand(domain: string, opts: FetchBrandOpts = {}): Promise<BrandAssets | null> {
  const apiKey = opts.apiKey ?? process.env.BRANDFETCH_API_KEY ?? process.env.BRAND_DEV_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    return null;
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const endpoint = opts.endpoint ?? "https://api.brandfetch.io/v2/brands/";
  const url = `${endpoint}${encodeURIComponent(domain)}`;

  try {
    const res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!res.ok) {
      return null;
    }

    return parseBrandResponse(await res.json());
  } catch {
    return null;
  }
}

function normalizeHex(hex: string): string | undefined {
  const trimmed = hex.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return undefined;
}

function normalizeColors(
  colors: Array<{ hex: string; type?: string }> | Record<string, string> | undefined,
): ColorCandidate[] {
  if (colors === undefined) {
    return [];
  }

  if (Array.isArray(colors)) {
    return colors
      .filter((color) => typeof color.hex === "string" && color.hex.trim().length > 0)
      .map((color) => ({ hex: color.hex, label: color.type }));
  }

  return Object.entries(colors)
    .filter(([, hex]) => typeof hex === "string" && hex.trim().length > 0)
    .map(([label, hex]) => ({ hex, label }));
}

function readColors(value: unknown): Array<{ hex: string; type?: string }> | Record<string, string> | undefined {
  if (Array.isArray(value)) {
    return value
      .filter(isRecord)
      .flatMap((color) => {
        if (typeof color.hex !== "string") {
          return [];
        }

        return [{ hex: color.hex, type: typeof color.type === "string" ? color.type : undefined }];
      });
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const colors: Record<string, string> = {};
  for (const [key, color] of Object.entries(value)) {
    if (typeof color === "string") {
      colors[key] = color;
    }
  }

  return colors;
}

function readFonts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((font) => {
    if (typeof font === "string" && font.trim().length > 0) {
      return [font];
    }
    if (isRecord(font) && typeof font.name === "string" && font.name.trim().length > 0) {
      return [font.name];
    }
    return [];
  });
}

function readLogoUrl(resp: Record<string, unknown>): string | undefined {
  const logos = resp.logos;
  if (Array.isArray(logos)) {
    for (const logo of logos) {
      const src = readSrcFromLogo(logo);
      if (src !== undefined) {
        return src;
      }
    }
  }

  return readSrcFromLogo(resp.logo);
}

function readSrcFromLogo(logo: unknown): string | undefined {
  if (!isRecord(logo)) {
    return undefined;
  }

  if (typeof logo.src === "string") {
    return logo.src;
  }

  const formats = logo.formats;
  if (Array.isArray(formats)) {
    for (const format of formats) {
      if (isRecord(format) && typeof format.src === "string") {
        return format.src;
      }
    }
  }

  return undefined;
}
