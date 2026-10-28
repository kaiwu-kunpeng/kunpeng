export interface RefPositioning {
  title?: string;
  description?: string;
}

export interface RefBrandStyles {
  colors: string[];
  fonts: string[];
}

const STATIC_EXTENSIONS = [
  ".css",
  ".js",
  ".mjs",
  ".woff2",
  ".woff",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".ico",
  ".webp",
  ".mp3",
  ".mp4",
  ".json",
];

const STATIC_PATH_SEGMENTS = ["/cdn-cgi/", "/static/", "/_next/"];

function extractStyleSources(rawHtml: string): string[] {
  const sources: string[] = [];
  const styleBlockPattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (const match of rawHtml.matchAll(styleBlockPattern)) {
    sources.push(match[1] ?? "");
  }

  const styleAttrPattern = /\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi;
  for (const match of rawHtml.matchAll(styleAttrPattern)) {
    sources.push(match[2] ?? "");
  }

  return sources;
}

function firstFontName(fontFamilyValue: string): string {
  let quote: string | undefined;
  let first = "";
  for (const char of fontFamilyValue) {
    if ((char === "\"" || char === "'") && quote === undefined) {
      quote = char;
    } else if (char === quote) {
      quote = undefined;
    } else if (char === "," && quote === undefined) {
      break;
    }
    first += char;
  }

  return first.trim().replace(/^['"]|['"]$/g, "").trim();
}

export function extractBrandStyles(rawHtml: string): RefBrandStyles {
  if (rawHtml.length === 0) {
    return { colors: [], fonts: [] };
  }

  const colorCounts = new Map<string, { count: number; firstIndex: number }>();
  const fonts: string[] = [];
  const seenFonts = new Set<string>();
  let colorIndex = 0;

  for (const source of extractStyleSources(rawHtml)) {
    const colorPattern = /#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi;
    for (const match of source.matchAll(colorPattern)) {
      const color = match[0].toLowerCase();
      const existing = colorCounts.get(color);
      if (existing) {
        existing.count += 1;
      } else {
        colorCounts.set(color, { count: 1, firstIndex: colorIndex });
      }
      colorIndex += 1;
    }

    if (fonts.length < 4) {
      const fontPattern = /font-family\s*:\s*([^;}]+)/gi;
      for (const match of source.matchAll(fontPattern)) {
        const font = firstFontName(match[1] ?? "");
        if (font.length === 0 || seenFonts.has(font)) {
          continue;
        }
        seenFonts.add(font);
        fonts.push(font);
        if (fonts.length >= 4) {
          break;
        }
      }
    }
  }

  const colors = [...colorCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].firstIndex - b[1].firstIndex)
    .slice(0, 8)
    .map(([color]) => color);

  return { colors, fonts };
}

export function parseIaFromLinks(links: string[], host: string): string[] {
  const paths = new Set<string>();

  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }

    if (url.host !== host) {
      continue;
    }

    const pathname = url.pathname;
    if (STATIC_EXTENSIONS.some((extension) => pathname.endsWith(extension))) {
      continue;
    }
    if (STATIC_PATH_SEGMENTS.some((segment) => pathname.includes(segment))) {
      continue;
    }

    paths.add(pathname);
  }

  return [...paths].sort();
}

export function extractPositioning(metadata: Record<string, unknown>): RefPositioning {
  const title = typeof metadata.title === "string"
    ? metadata.title
    : typeof metadata["og:title"] === "string"
      ? metadata["og:title"]
      : undefined;
  const description = typeof metadata.description === "string"
    ? metadata.description
    : typeof metadata["og:description"] === "string"
      ? metadata["og:description"]
      : undefined;

  return { title, description };
}

export function extractThemeColor(metadata: Record<string, unknown>): string | undefined {
  const c = metadata["theme-color"];
  return typeof c === "string" ? c : undefined;
}
