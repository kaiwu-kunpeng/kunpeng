import { load, type CheerioAPI } from "cheerio";
import { isRecord } from "../../util/is-record.js";
import type { Finding } from "../page-audit.js";
import { countWords } from "../text-metrics.js";
import { visibleText } from "./first-html.js";
import { extractJsonLd } from "./structured-data.js";

export const GEO_RUBRIC_VERSION = "kp-geo-v1";

export interface GeoCitabilityCheck {
  id: string;
  points: number;
  max: number;
  observable: boolean;
  evidence: string;
}

export interface GeoCitabilityResult {
  url: string;
  rubric: typeof GEO_RUBRIC_VERSION;
  score: number;
  earned: number;
  observableMax: number;
  checks: GeoCitabilityCheck[];
  findings: Finding[];
}

const CONTENT_TYPES = new Set([
  "Article", "NewsArticle", "BlogPosting", "Product", "FAQPage", "QAPage", "Recipe",
  "Event", "LocalBusiness", "JobPosting", "VideoObject", "Course", "Dataset",
]);
const QUESTION = /[?？]$|^(how|what|why|when|where|which|who|can|does|do|is|are|should)(?:\s|$)|^(如何|怎么|怎样|什么|为什么|哪|是否|能否)/i;

function nonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function freshness($: CheerioAPI, nodes: Record<string, unknown>[], now: number): GeoCitabilityCheck {
  const dates: unknown[] = nodes.flatMap((node) => [node.dateModified, node.datePublished]);
  $("meta[property='article:modified_time'], meta[property='article:published_time']")
    .each((_index, element) => { dates.push($(element).attr("content")); });
  $("time[datetime]").each((_index, element) => { dates.push($(element).attr("datetime")); });
  let latest: number | undefined;
  for (const date of dates) {
    if (typeof date !== "string") continue;
    const parsed = Date.parse(date);
    if (Number.isFinite(parsed) && (latest === undefined || parsed > latest)) latest = parsed;
  }
  return {
    id: "freshness", max: 6, observable: true,
    points: latest === undefined ? 0 : 3 + (Math.abs(now - latest) <= 365 * 86_400_000 ? 3 : 0),
    evidence: latest === undefined ? "" : new Date(latest).toISOString(),
  };
}

function authorship($: CheerioAPI, nodes: Record<string, unknown>[]): GeoCitabilityCheck {
  const authors: unknown[] = nodes.flatMap((node) => Array.isArray(node.author) ? node.author : [node.author]);
  const names = authors.map((author) => nonEmptyString(isRecord(author) ? author.name : author));
  const metaNames = $("meta[name='author']").toArray().map((element) => nonEmptyString($(element).attr("content")));
  const links = $("a[rel~='author']").toArray();
  const name = [...names, ...metaNames, ...links.map((element) => $(element).text().trim())].find(Boolean) ?? "";
  const hasAuthor = name !== "" || links.length > 0;
  const hasLink = authors.some((author) => {
    if (!isRecord(author)) return false;
    const sameAs: unknown[] = Array.isArray(author.sameAs) ? author.sameAs : [author.sameAs];
    return nonEmptyString(author.url) !== "" || sameAs.some((value) => nonEmptyString(value) !== "");
  }) || links.some((element) => nonEmptyString($(element).attr("href")) !== "");
  return {
    id: "authorship", max: 6, observable: true,
    points: (hasAuthor ? 3 : 0) + (hasLink ? 3 : 0), evidence: name,
  };
}

export function checkGeoCitability(input: { url: string; html: string; now: number }): GeoCitabilityResult {
  const { url, html, now } = input;
  const $ = load(html);
  const nodes = extractJsonLd(html).nodes.map(({ node }) => node);
  const main = $("main").first();
  const article = $("article").first();
  const body = (main.length > 0 ? main : article.length > 0 ? article : $("body")).clone();
  body.find("nav, header, footer, aside, script, style, noscript, template, svg").remove();

  const firstWords = body.find("p").toArray().map((element) => countWords($(element).text()))
    .find((words) => words >= 1);
  const headings = body.find("h2, h3").toArray();
  const questions = headings.filter((element) => QUESTION.test($(element).text().trim())).length;
  const stats = /\d[\d,.]*\s?(%|％|percent|per cent|million|billion|万|亿|倍)/i.test(body.text());
  const cite = body.find("a[href]").toArray().some((element) => {
    try {
      const target = new URL($(element).attr("href") ?? "", url);
      return (target.protocol === "http:" || target.protocol === "https:")
        && target.hostname !== new URL(url).hostname;
    } catch {
      // Invalid links cannot provide an external source signal.
      return false;
    }
  });
  const quotations = body.find("blockquote, q").length;
  const wordCount = countWords(visibleText(html));
  const types = [...new Set(nodes.flatMap((node) => {
    const values: unknown[] = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    return values.map(nonEmptyString).filter(Boolean);
  }))];
  const lists = body.find("ul, ol").toArray().filter((element) => $(element).children("li").length >= 3).length;
  const tables = body.find("table").toArray().filter((element) => $(element).find("tr").length >= 2).length;
  const checks: GeoCitabilityCheck[] = [
    {
      id: "answer-first", max: 9, observable: true,
      points: firstWords === undefined || firstWords < 20 ? 0 : firstWords <= 120 ? 9 : 4,
      evidence: firstWords === undefined ? "" : String(firstWords),
    },
    {
      id: "question-headings", max: 7, observable: headings.length > 0,
      points: headings.length === 0 ? 0 : Math.round(7 * Math.min(1, (questions / headings.length) / 0.5)),
      evidence: `${questions}/${headings.length}`,
    },
    {
      id: "sourced-statistics", max: 7, observable: true, points: stats ? (cite ? 7 : 3) : 0,
      evidence: `stats=${stats ? "yes" : "no"} cite=${cite ? "yes" : "no"}`,
    },
    { id: "quotations", max: 4, observable: true, points: quotations > 0 ? 4 : 0, evidence: String(quotations) },
    freshness($, nodes, now),
    authorship($, nodes),
    {
      id: "server-rendered", max: 5, observable: true,
      points: wordCount >= 150 ? 5 : wordCount >= 50 ? 2 : 0, evidence: String(wordCount),
    },
    {
      id: "structured-data", max: 4, observable: true,
      points: (types.length > 0 ? 2 : 0) + (types.some((type) => CONTENT_TYPES.has(type)) ? 2 : 0),
      evidence: types.join(","),
    },
    {
      id: "extractable-structure", max: 4, observable: true,
      points: lists > 0 || tables > 0 ? 4 : 0, evidence: `lists=${lists} tables=${tables}`,
    },
  ];
  const observable = checks.filter((check) => check.observable);
  const earned = observable.reduce((sum, check) => sum + check.points, 0);
  const observableMax = observable.reduce((sum, check) => sum + check.max, 0);
  const findings: Finding[] = observable.filter((check) => check.points < check.max).map((check) => ({
    rule: `geo-${check.id}`, severity: check.points === 0 ? "warn" : "info",
    message: `GEO ${check.id}: ${check.points}/${check.max} points.`, evidence: check.evidence,
  }));
  return { url, rubric: GEO_RUBRIC_VERSION, score: Math.round(100 * earned / observableMax), earned, observableMax, checks, findings };
}

export function runGeoCitabilityGate(pages: Array<{ url: string; html: string }>, now: number): {
  rubric: typeof GEO_RUBRIC_VERSION;
  checked: number;
  averageScore: number;
  pages: GeoCitabilityResult[];
} {
  const results = pages.map((page) => checkGeoCitability({ ...page, now }));
  return {
    rubric: GEO_RUBRIC_VERSION, checked: results.length,
    averageScore: results.length === 0 ? 0 : Math.round(results.reduce((sum, page) => sum + page.score, 0) / results.length),
    pages: results,
  };
}
