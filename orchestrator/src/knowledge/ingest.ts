export interface Capture {
  id: string;
  source: "text" | "url" | "file";
  origin: string;
  raw: string;
  title?: string;
  summary: string;
  tags: string[];
  category?: string;
  capturedAt: number;
}

export interface IngestDeps {
  summarize: (raw: string) => Promise<{ summary: string; tags: string[]; category?: string; title?: string }>;
  fetchUrl: (url: string) => Promise<string>;
  readFile: (path: string) => Promise<string>;
  now: () => number;
  newId: () => string;
}

export type IngestInput =
  | { kind: "text"; text: string }
  | { kind: "url"; url: string }
  | { kind: "file"; path: string };

type CaptureSource = Capture["source"];

interface CapturePartial {
  source: CaptureSource;
  origin: string;
  raw: string;
}

const URL_CANDIDATE = /\bhttps?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&()*+,;=%]+/iu;
const TRAILING_URL_JUNK = /[.,;:!?，。！？、；：)\]}]+$/u;

export function extractUrl(input: string): string | null {
  const match = input.match(URL_CANDIDATE);
  if (!match) return null;

  let candidate = match[0];
  while (TRAILING_URL_JUNK.test(candidate)) {
    candidate = candidate.replace(TRAILING_URL_JUNK, "");
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function finalize(partial: CapturePartial, deps: IngestDeps): Promise<Capture> {
  const { summary, tags, category, title } = await deps.summarize(partial.raw);

  return {
    ...partial,
    id: deps.newId(),
    title,
    summary,
    tags: [...new Set(tags)],
    category,
    capturedAt: deps.now(),
  };
}

export async function ingestText(text: string, deps: IngestDeps): Promise<Capture> {
  return finalize({ source: "text", origin: "inline", raw: text }, deps);
}

export async function ingestUrl(url: string, deps: IngestDeps): Promise<Capture> {
  const normalizedUrl = extractUrl(url);
  if (normalizedUrl === null) throw new Error("URL 捕获缺少合法 http(s) URL");
  const raw = await deps.fetchUrl(normalizedUrl);
  return finalize({ source: "url", origin: normalizedUrl, raw }, deps);
}

export async function ingestFile(path: string, deps: IngestDeps): Promise<Capture> {
  const raw = await deps.readFile(path);
  return finalize({ source: "file", origin: path, raw }, deps);
}

export async function ingest(input: IngestInput, deps: IngestDeps): Promise<Capture> {
  switch (input.kind) {
    case "text":
      return ingestText(input.text, deps);
    case "url":
      return ingestUrl(input.url, deps);
    case "file":
      return ingestFile(input.path, deps);
    default: {
      const exhaustive: never = input;
      throw new Error(`Unknown ingest input kind: ${String(exhaustive)}`);
    }
  }
}
