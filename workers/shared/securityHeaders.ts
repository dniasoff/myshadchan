import type { MiddlewareHandler } from "hono";

// ARCHITECTURE-SPINE.md, "Security (Workers)" convention — every Worker
// response carries these headers. CSP is a frontend/SPA concern (nonce-based,
// applies to rendered HTML) and doesn't apply to these JSON-only APIs.
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload",
  );
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
};
