import * as cheerio from "cheerio";
import type { Finding } from "../page-audit.js";
import { countWords } from "../text-metrics.js";

export interface FirstHtmlExpectation {
  id: string;
  text?: string;
  regex?: string;
  selector?: string;
}

export interface FirstHtmlCheckInput {
  url: string;
  html: string;
  expectations: FirstHtmlExpectation[];
  minWords?: number;
}

export interface FirstHtmlGateResult {
  ok: boolean;
  findings: Finding[];
  wordCount: number;
  shell: boolean;
  present: string[];
  missing: string[];
}

export function visibleText(html: string, selector?: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, template, svg").remove();
  return (selector ? $(selector).text() : $("body").text())
    .replace(/\s+/g, " ").trim();
}

export function checkFirstHtml(input: FirstHtmlCheckInput): FirstHtmlGateResult {
  const { html, expectations, minWords = 150 } = input;
  const text = visibleText(html);
  const wordCount = countWords(text);
  const shell = wordCount < minWords;
  const findings: Finding[] = [];
  const present: string[] = [];
  const missing: string[] = [];

  if (shell) {
    findings.push({
      rule: "first-html-shell",
      severity: "error",
      message: `First HTML has ${wordCount} words; minimum is ${minWords}.`,
    });
  }

  const $ = cheerio.load(html);
  if ($("noscript").toArray().some((element) =>
    /enable javascript|javascript is (required|disabled)/i.test($(element).text()),
  )) {
    findings.push({
      rule: "first-html-noscript",
      severity: "warn",
      message: "First HTML contains a noscript notice requiring JavaScript.",
    });
  }

  for (const selector of ["#__next", "#root", "#app"]) {
    const root = $(selector);
    if (root.length > 0 && root.text().trim() === "") {
      findings.push({
        rule: "first-html-empty-root",
        severity: "warn",
        message: `First HTML contains an empty application root ${selector}.`,
        evidence: selector,
      });
      break;
    }
  }

  for (const expectation of expectations) {
    const target = expectation.selector ? visibleText(html, expectation.selector) : text;
    const matches = target !== ""
      && (expectation.text !== undefined || expectation.regex !== undefined)
      && (expectation.text === undefined || target.toLowerCase().replace(/\s+/g, " ").trim()
        .includes(expectation.text.toLowerCase().replace(/\s+/g, " ").trim()))
      && (expectation.regex === undefined || new RegExp(expectation.regex, "i").test(target));
    if (matches) {
      present.push(expectation.id);
    } else {
      missing.push(expectation.id);
      findings.push({
        rule: "first-html-missing",
        severity: "error",
        message: `First HTML is missing expectation ${expectation.id}.`,
        evidence: expectation.text ?? expectation.regex,
      });
    }
  }

  return {
    ok: !findings.some((finding) => finding.severity === "error"),
    findings,
    wordCount,
    shell,
    present,
    missing,
  };
}

export interface FirstHtmlGateOptions {
  url: string;
  expectations: FirstHtmlExpectation[];
  minWords?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export async function runFirstHtmlGate(
  opts: FirstHtmlGateOptions,
): Promise<FirstHtmlGateResult & { status: number }> {
  const { url, expectations, minWords, fetchImpl = fetch, userAgent = "kunpeng-seo/0.1" } = opts;
  let status: number;
  let evidence = "";
  let html = "";
  try {
    const res = await fetchImpl(url, {
      headers: { "user-agent": userAgent, accept: "text/html" },
      redirect: "follow",
    });
    status = res.status;
    if (status === 200) {
      html = await res.text();
    } else {
      evidence = String(status);
    }
  } catch (err) {
    status = 0;
    evidence = err instanceof Error ? err.message : String(err);
  }

  if (status !== 200) {
    return {
      ok: false,
      findings: [{
        rule: "first-html-status",
        severity: "error",
        message: `Failed to fetch first HTML for ${url}: status ${status}.`,
        evidence,
      }],
      wordCount: 0,
      shell: true,
      present: [],
      missing: expectations.map((expectation) => expectation.id),
      status,
    };
  }

  return { ...checkFirstHtml({ url, html, expectations, minWords }), status: 200 };
}
