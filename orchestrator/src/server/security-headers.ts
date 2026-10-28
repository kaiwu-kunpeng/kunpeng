import type { IncomingMessage, ServerResponse } from "node:http";

export function applySecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "SAMEORIGIN");
  res.setHeader("referrer-policy", "same-origin");
  res.setHeader("content-security-policy", "frame-ancestors 'self'; object-src 'none'; base-uri 'self'");

  if (req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("strict-transport-security", "max-age=31536000");
  }
}
