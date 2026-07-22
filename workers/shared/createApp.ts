import { Hono } from "hono";
import { ok } from "./envelope";
import type { BaseEnv } from "./env";
import { securityHeaders } from "./securityHeaders";

// Every Worker starts from this: a Hono app with the security headers and the
// one route common to all of them. Business routes are added by each worker's
// own index.ts.
export function createWorkerApp<Bindings extends BaseEnv = BaseEnv>(
  name: string,
) {
  const app = new Hono<{ Bindings: Bindings }>();

  app.use("*", securityHeaders);
  app.get("/health", (c) => c.json(ok({ worker: name, status: "ok" })));

  return app;
}
