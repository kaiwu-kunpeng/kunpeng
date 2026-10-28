import { tokenize } from "./tokenize.js";

export interface Capture {
  id: string;
  source: string;
  text: string;
  tags?: string[];
  title?: string;
}

export interface RetrieveOptions {
  limit?: number;
  snippetRadius?: number;
  caseSensitive?: boolean;
}

export interface Citation {
  source: string;
  snippet: string;
  matchedTerms: string[];
}

export interface RetrieveHit {
  capture: Capture;
  score: number;
  citation: Citation;
}

interface TermMatch {
  term: string;
  textIndex: number;
}

const DEFAULT_LIMIT = 5;
const DEFAULT_SNIPPET_RADIUS = 40;
const ELLIPSIS = "…";
const K1 = 1.5;
const B = 0.75;

interface DocStats {
  capture: Capture;
  tokens: string[];
  titleTokens: Set<string>;
  tags: Set<string>;
  tf: Map<string, number>;
  dl: number;
}

function uniqueTokens(tokens: string[]): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const term of tokens) {
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }

  return terms;
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

function snippetAround(text: string, index: number, termLength: number, radius: number): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + termLength + radius);
  const prefix = start > 0 ? ELLIPSIS : "";
  const suffix = end < text.length ? ELLIPSIS : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function openingSnippet(text: string, radius: number): string {
  const end = Math.min(text.length, radius * 2);
  return `${text.slice(0, end)}${end < text.length ? ELLIPSIS : ""}`;
}

function findOriginalTextIndex(text: string, term: string): number {
  return text.toLowerCase().indexOf(term.toLowerCase());
}

function idf(term: string, df: Map<string, number>, corpusSize: number): number {
  const documentFrequency = df.get(term) ?? 0;
  return Math.log(1 + (corpusSize - documentFrequency + 0.5) / (documentFrequency + 0.5));
}

function bm25TermScore(tf: number, dl: number, avgdl: number, termIdf: number): number {
  if (tf <= 0 || dl <= 0) return 0;
  const denominator = tf + K1 * (1 - B + B * (dl / avgdl));
  return termIdf * ((tf * (K1 + 1)) / denominator);
}

function buildDocStats(captures: Capture[]): { docs: DocStats[]; df: Map<string, number>; avgdl: number } {
  const df = new Map<string, number>();
  let totalLength = 0;
  const docs = captures.map((capture) => {
    const tokens = tokenize(capture.text);
    const tf = termFrequency(tokens);
    const titleTokens = new Set(capture.title === undefined ? [] : tokenize(capture.title));
    const tags = new Set(capture.tags?.map((tag) => tag.trim().toLowerCase()).filter(Boolean) ?? []);

    totalLength += tokens.length;
    for (const token of new Set(tokens)) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }

    return {
      capture,
      tokens,
      titleTokens,
      tags,
      tf,
      dl: tokens.length,
    };
  });

  return {
    docs,
    df,
    avgdl: captures.length > 0 && totalLength > 0 ? totalLength / captures.length : 1,
  };
}

export function retrieveCaptures(query: string, captures: Capture[], opts?: RetrieveOptions): RetrieveHit[] {
  const terms = uniqueTokens(tokenize(query));
  if (terms.length === 0) return [];

  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const snippetRadius = opts?.snippetRadius ?? DEFAULT_SNIPPET_RADIUS;
  const { docs, df, avgdl } = buildDocStats(captures);
  const corpusSize = captures.length;

  const hits: RetrieveHit[] = [];

  for (const doc of docs) {
    const matches: TermMatch[] = [];
    let score = 0;

    for (const term of terms) {
      const termIdf = idf(term, df, corpusSize);
      const textFrequency = doc.tf.get(term) ?? 0;
      const titleMatched = doc.titleTokens.has(term);
      const tagMatched = doc.tags.has(term);
      const textScore = bm25TermScore(textFrequency, doc.dl, avgdl, termIdf);

      score += textScore;
      if (titleMatched) score += 1.5 * termIdf;
      if (tagMatched) score += 2 * termIdf;

      if (textFrequency > 0 || titleMatched || tagMatched) {
        matches.push({
          term,
          textIndex: textFrequency > 0 ? findOriginalTextIndex(doc.capture.text, term) : -1,
        });
      }
    }

    if (score <= 0) continue;

    const firstTextMatch = matches.find((match) => match.textIndex >= 0);
    const snippet = firstTextMatch
      ? snippetAround(doc.capture.text, firstTextMatch.textIndex, firstTextMatch.term.length, snippetRadius)
      : openingSnippet(doc.capture.text, snippetRadius);

    hits.push({
      capture: doc.capture,
      score,
      citation: {
        source: doc.capture.source,
        snippet,
        matchedTerms: matches.map((match) => match.term),
      },
    });
  }

  const sorted = hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.capture.id.localeCompare(b.capture.id);
  });

  return limit <= 0 ? sorted : sorted.slice(0, limit);
}
