import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve as pathResolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { appendFeedback, appendOpsEvent, appendPick, kpBeaconSnippet } from "../product/ops-kit.js";
import { beaconSecret, beaconToken, verifyBeaconToken } from "../product/beacon-token.js";
import { kunpengStateDir } from "../project/registry.js";
import { MANIFEST, SERVICE_WORKER, splashPng } from "./pwa.js";
import { ICON_PNG_BASE64 } from "./ui/brand-assets.js";
import { gateProjects } from "./project-scope.js";
import { readLimitedJsonBody } from "./read-body.js";
import { vendorResponse } from "./vendor-static.js";

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function setBeaconCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
}

function requestOrigin(req: IncomingMessage): string {
  const rawProto = firstHeader(req.headers["x-forwarded-proto"]) ?? "http";
  const proto = rawProto.split(",")[0]?.trim() || "http";
  const host = firstHeader(req.headers.host) ?? "127.0.0.1";
  return `${proto}://${host}`;
}

function scriptBody(snippet: string): string {
  return snippet.replace(/^<script>/, "").replace(/<\/script>$/, "");
}

function parseBeaconBody(body: Record<string, unknown>): { slug: string; kind: string; name?: string } | undefined {
  if (typeof body.slug !== "string" || typeof body.kind !== "string") return undefined;
  const evt: { slug: string; kind: string; name?: string } = { slug: body.slug, kind: body.kind };
  if (typeof body.name === "string") evt.name = body.name;
  return evt;
}

export async function serveBeacon(
  opts: { repoRoot?: string; stateDir?: string },
  method: string,
  path: string,
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (path === "/api/beacon" && method === "OPTIONS") {
    setBeaconCors(res);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (path === "/kp-beacon.js" && method === "GET") {
    const slug = new URL(url, "http://x").searchParams.get("slug") ?? "";
    let secret: string;
    try {
      secret = await beaconSecret(opts.stateDir ?? kunpengStateDir());
    } catch {
      res.statusCode = 500;
      res.end();
      return true;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/javascript; charset=utf-8");
    res.end(scriptBody(kpBeaconSnippet(slug, requestOrigin(req), beaconToken(slug, secret))));
    return true;
  }

  return false;
}

export async function serveBeaconIngest(
  opts: { repoRoot?: string; stateDir?: string },
  method: string,
  path: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (path === "/api/beacon" && method === "POST") {
    setBeaconCors(res);
    const parsed = await readLimitedJsonBody(req, 1024);
    if (!parsed.ok) {
      res.statusCode = parsed.status;
      res.end();
      return true;
    }

    const body = parsed.body;
    const slug = body.slug;
    const secret = await beaconSecret(opts.stateDir ?? kunpengStateDir());
    if (typeof slug !== "string" || slug.trim() === "" || !verifyBeaconToken(slug, body.t, secret)) {
      res.statusCode = 401;
      res.end();
      return true;
    }
    if (
      body.kind === "pick"
      && typeof body.slug === "string"
      && body.slug.trim() !== ""
      && typeof body.selector === "string"
      && body.selector.trim() !== ""
    ) {
      const now = Date.now();
      const pick: { selector: string; text?: string } = { selector: body.selector };
      if (typeof body.text === "string") {
        pick.text = body.text;
      }
      for (const repoPath of await gateProjects(opts)) {
        if (await appendPick(repoPath, body.slug, pick, now)) break;
      }
    } else if (
      body.kind === "feedback"
      && typeof body.slug === "string"
      && body.slug.trim() !== ""
      && typeof body.score === "number"
    ) {
      const now = Date.now();
      const fb: { score: number; comment?: string } = { score: body.score };
      if (typeof body.comment === "string") {
        fb.comment = body.comment;
      }
      for (const repoPath of await gateProjects(opts)) {
        if (await appendFeedback(repoPath, body.slug, fb, now)) break;
      }
    } else {
      const evt = parseBeaconBody(body);
      if (evt) {
        const now = Date.now();
        for (const repoPath of await gateProjects(opts)) {
          if (await appendOpsEvent(repoPath, evt.slug, { kind: evt.kind, name: evt.name }, now)) break;
        }
      }
    }

    res.statusCode = 204;
    res.end();
    return true;
  }

  return false;
}

export function servePwaStatic(method: string, path: string, res: ServerResponse): boolean {
  if (method === "GET" && path === "/manifest.webmanifest") {
    res.setHeader("content-type", "application/manifest+json; charset=utf-8");
    res.setHeader("cache-control", "no-cache");
    res.end(JSON.stringify(MANIFEST));
    return true;
  }

  if (method === "GET" && path === "/sw.js") {
    res.setHeader("content-type", "application/javascript; charset=utf-8");
    res.setHeader("cache-control", "no-cache");
    res.end(SERVICE_WORKER);
    return true;
  }

  if (method === "GET" && (path === "/icon-192.png" || path === "/icon-512.png" || path === "/apple-touch-icon.png")) {
    const size = path === "/apple-touch-icon.png" ? 180 : path === "/icon-512.png" ? 512 : 192;
    res.setHeader("content-type", "image/png");
    res.setHeader("cache-control", "public, max-age=86400");
    res.end(Buffer.from(ICON_PNG_BASE64[size], "base64"));
    return true;
  }

  const splashMatch = /^\/splash-(\d+)x(\d+)\.png$/.exec(path);
  if (method === "GET" && splashMatch) {
    const [, width = "0", height = "0"] = splashMatch;
    res.setHeader("content-type", "image/png");
    res.setHeader("cache-control", "public, max-age=86400");
    res.end(splashPng(Number(width), Number(height)));
    return true;
  }

  return false;
}

const VENDOR_ASSETS = {
  "cytoscape.min.js": "application/javascript; charset=utf-8",
  "elk.bundled.js": "application/javascript; charset=utf-8",
  "cytoscape-elk.js": "application/javascript; charset=utf-8",
  "xterm.min.js": "application/javascript; charset=utf-8",
  "xterm-addon-fit.min.js": "application/javascript; charset=utf-8",
  "xterm.min.css": "text/css; charset=utf-8",
  "tesseract/tesseract.min.js": "application/javascript",
  "tesseract/worker.min.js": "application/javascript",
  "tesseract/tesseract-core-simd-lstm.wasm.js": "application/javascript",
  "tesseract/chi_sim.traineddata.gz": "application/gzip",
  "tesseract/eng.traineddata.gz": "application/gzip",
  "pdfjs/pdf.min.mjs": "application/javascript; charset=utf-8",
  "pdfjs/pdf.worker.min.mjs": "application/javascript; charset=utf-8",
  "mermaid/mermaid.min.js": "application/javascript",
  "katex/katex.min.js": "application/javascript",
  "katex/katex.min.css": "text/css",
} as const;

type VendorAssetName = keyof typeof VENDOR_ASSETS;

function isVendorAssetName(name: string): name is VendorAssetName {
  return Object.prototype.hasOwnProperty.call(VENDOR_ASSETS, name);
}

export async function serveVendorStatic(req: IncomingMessage, method: string, path: string, res: ServerResponse): Promise<boolean> {
  if (method !== "GET" || !path.startsWith("/vendor/")) return false;

  let name: string;
  try {
    name = decodeURIComponent(path.slice("/vendor/".length));
  } catch {
    name = "";
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const vendorRoot = pathResolve(here, "..", "..", "assets", "vendor");
  const assetPath = pathResolve(vendorRoot, name);
  const insideVendorRoot = assetPath.startsWith(`${vendorRoot}${sep}`);
  const katexFontRoot = pathResolve(vendorRoot, "katex", "fonts");
  const isKatexWoff2 = name.startsWith("katex/fonts/")
    && name.endsWith(".woff2")
    && assetPath.startsWith(`${katexFontRoot}${sep}`);
  const contentType = isVendorAssetName(name)
    ? VENDOR_ASSETS[name]
    : isKatexWoff2
      ? "font/woff2"
      : undefined;
  if (!insideVendorRoot || !contentType) {
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("vendor asset not found");
    return true;
  }

  try {
    const vr = await vendorResponse(name, contentType, () => readFile(assetPath), {
      acceptEncoding: req.headers["accept-encoding"],
      ifNoneMatch: req.headers["if-none-match"],
    });
    res.statusCode = vr.status;
    for (const [key, value] of Object.entries(vr.headers)) res.setHeader(key, value);
    res.end(vr.body);
  } catch {
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(`vendor asset missing: ${name}`);
  }
  return true;
}
