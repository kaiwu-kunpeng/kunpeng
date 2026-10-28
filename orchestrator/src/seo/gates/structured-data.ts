import { load } from "cheerio";
import { isRecord } from "../../util/is-record.js";
import type { Finding } from "../page-audit.js";

interface JsonLdExtraction {
  blocks: number;
  nodes: Array<{ node: Record<string, unknown>; path: string }>;
  errors: Array<{ block: number; message: string }>;
}

export interface StructuredDataResult {
  ok: boolean;
  blocks: number;
  types: string[];
  findings: Finding[];
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ""
    && (!Array.isArray(value) || value.length > 0);
}

function hasSchemaContext(context: unknown): boolean {
  try {
    return String(context).includes("schema.org");
  } catch {
    // A JSON object can shadow toString; such a context is still reported as invalid.
    return false;
  }
}

function parseJsonLd(html: string): JsonLdExtraction & { raw: string[]; noContext: Set<number> } {
  const $ = load(html);
  const raw = $("script").toArray()
    .filter((script) => $(script).attr("type")?.trim().toLowerCase() === "application/ld+json")
    .map((script) => $(script).text());
  const nodes: JsonLdExtraction["nodes"] = [];
  const errors: JsonLdExtraction["errors"] = [];
  const noContext = new Set<number>();

  const expand = (value: unknown, path: string, block: number, context?: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach((item: unknown, index) => expand(item, `${path}[${index}]`, block, context));
      return;
    }
    if (!isRecord(value)) return;
    const node = context !== undefined && !Object.hasOwn(value, "@context")
      ? { "@context": context, ...value } : value;
    if (!hasSchemaContext(node["@context"])) noContext.add(block);
    if (Array.isArray(node["@graph"])) {
      node["@graph"].forEach((item: unknown, index) =>
        expand(item, `${path}@graph[${index}]`, block, node["@context"]));
    } else {
      nodes.push({ node, path });
    }
  };

  raw.forEach((text, block) => {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      errors.push({ block, message: error instanceof Error ? error.message : String(error) });
      return;
    }
    expand(value, String(block), block);
  });
  return { blocks: raw.length, nodes, errors, raw, noContext };
}

export function extractJsonLd(html: string): JsonLdExtraction {
  const { blocks, nodes, errors } = parseJsonLd(html);
  return { blocks, nodes, errors };
}

const FIELD_RULES = new Map<string, { required?: string[]; recommended?: string[] }>([
  ["Product", { required: ["name"], recommended: ["image", "description"] }],
  ...["Article", "NewsArticle", "BlogPosting"].map((type): [string, { recommended: string[] }] =>
    [type, { recommended: ["headline", "image", "datePublished", "author"] }]),
  ["FAQPage", { required: ["mainEntity"] }],
  ["BreadcrumbList", { required: ["itemListElement"] }],
  ["Organization", { recommended: ["name", "url", "logo"] }],
  ["LocalBusiness", { required: ["name", "address"] }],
  ["Event", { required: ["name", "startDate", "location"] }],
  ["Recipe", { required: ["name", "image"] }],
  ["VideoObject", { required: ["name", "thumbnailUrl", "uploadDate"] }],
  ["JobPosting", { required: ["title", "description", "datePosted", "hiringOrganization"] }],
]);

function nodeTypes(node: Record<string, unknown>): string[] {
  const types: unknown[] = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  return [...new Set(types.filter((type): type is string => typeof type === "string"))];
}

function entries(value: unknown): Record<string, unknown>[] {
  if (!hasValue(value)) return [];
  const items: unknown[] = Array.isArray(value) ? value : [value];
  return items.map((item) => isRecord(item) ? item : {});
}

function checkNode(node: Record<string, unknown>): Finding[] {
  const findings: Finding[] = [];
  const reported = new Set<string>();
  for (const type of nodeTypes(node)) {
    const missing = (property: string, present: boolean, recommended = false): void => {
      const evidence = `${type}.${property}`;
      if (present || reported.has(evidence)) return;
      reported.add(evidence);
      findings.push({
        rule: recommended ? "sd-missing-recommended" : "sd-missing-required",
        severity: recommended ? "warn" : "error",
        message: `${type} is missing ${recommended ? "recommended" : "required"} property ${property}.`,
        evidence,
      });
    };
    const fields = FIELD_RULES.get(type);
    for (const field of fields?.required ?? []) missing(field, hasValue(node[field]));
    for (const field of fields?.recommended ?? []) missing(field, hasValue(node[field]), true);

    switch (type) {
      case "Product":
        missing("offers|review|aggregateRating",
          ["offers", "review", "aggregateRating"].some((field) => hasValue(node[field])));
        for (const offer of entries(node.offers)) {
          missing("offers.price", hasValue(offer.price) || hasValue(offer.priceSpecification));
          if (hasValue(offer.price)) missing("offers.priceCurrency", hasValue(offer.priceCurrency));
        }
        break;
      case "FAQPage":
        findings.push({
          rule: "sd-restricted-type",
          severity: "info",
          message: "FAQ rich results are restricted to authoritative government and health websites.",
          evidence: type,
        });
        for (const question of entries(node.mainEntity)) {
          missing("mainEntity.name", hasValue(question.name));
          const answer = isRecord(question.acceptedAnswer) ? question.acceptedAnswer : {};
          missing("mainEntity.acceptedAnswer.text", hasValue(answer.text));
        }
        break;
      case "HowTo":
        findings.push({
          rule: "sd-deprecated-type",
          severity: "warn",
          message: "Google no longer displays HowTo rich results.",
          evidence: type,
        });
        break;
      case "BreadcrumbList": {
        const items = entries(node.itemListElement);
        items.forEach((item, index) => {
          missing("itemListElement.position", typeof item.position === "number");
          missing("itemListElement.name", hasValue(item.name));
          if (index < items.length - 1) missing("itemListElement.item", hasValue(item.item));
        });
        break;
      }
      case "JobPosting":
        if (node.jobLocationType !== "TELECOMMUTE") missing("jobLocation", hasValue(node.jobLocation));
        break;
    }
  }
  return findings;
}

export function checkStructuredData(html: string): StructuredDataResult {
  const { blocks, nodes, errors, raw, noContext } = parseJsonLd(html);
  const findings: Finding[] = [];
  if (blocks === 0) {
    findings.push({ rule: "sd-none", severity: "info", message: "No JSON-LD blocks found." });
  }
  for (const error of errors) {
    findings.push({
      rule: "sd-json-invalid",
      severity: "error",
      message: `JSON-LD block ${error.block} is invalid: ${error.message}`,
      evidence: raw[error.block].trim().slice(0, 80),
    });
  }
  for (const block of noContext) {
    findings.push({
      rule: "sd-no-context",
      severity: "warn",
      message: `JSON-LD block ${block} is missing a schema.org context.`,
    });
  }
  const types = new Set<string>();
  for (const { node } of nodes) {
    for (const type of nodeTypes(node)) types.add(type);
    findings.push(...checkNode(node));
  }
  return { ok: !findings.some((finding) => finding.severity === "error"), blocks, types: [...types], findings };
}

export function runStructuredDataGate(pages: Array<{ url: string; html: string }>): {
  ok: boolean;
  checked: number;
  pages: Array<{ url: string } & StructuredDataResult>;
} {
  const results = pages.map(({ url, html }) => ({ url, ...checkStructuredData(html) }));
  return { ok: results.every((page) => page.ok), checked: results.length, pages: results };
}
