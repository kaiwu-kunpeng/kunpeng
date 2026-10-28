import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import { registerModularRoute } from "./registry.js";

const VENDOR_PREFIXES = ["build/", "cmaps/", "standard_fonts/"] as const;

export function vendorPdfjsRoot(): string | null {
  try {
    return dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  } catch {
    return null;
  }
}

export function resolveVendorPdfjsPath(f?: string | null): string | null {
  if (!f || f.startsWith("/") || f.includes("..")) return null;
  if (!VENDOR_PREFIXES.some((prefix) => f.startsWith(prefix))) return null;
  return posix.normalize(f);
}

export function vendorPdfjsContentType(f: string): string {
  return /[.](?:mjs|js)$/i.test(f)
    ? "application/javascript; charset=utf-8"
    : "application/octet-stream";
}

registerModularRoute({
  method: "GET",
  path: "/api/vendor/pdfjs",
  handle: async (_req, res, url) => {
    const f = new URL(url, "http://localhost").searchParams.get("f");
    const relativePath = resolveVendorPdfjsPath(f);
    if (!relativePath) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    const root = vendorPdfjsRoot();
    if (!root) {
      res.statusCode = 503;
      res.end("pdfjs unavailable");
      return;
    }

    try {
      const body = await readFile(join(root, relativePath));
      res.statusCode = 200;
      res.setHeader("content-type", vendorPdfjsContentType(relativePath));
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  },
});
