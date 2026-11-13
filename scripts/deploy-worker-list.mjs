#!/usr/bin/env node

// This list is the single source for the deploy matrix and the post-deploy
// completeness check. Analytics is intentionally excluded: it is not deployed
// by the production workflow yet.
export const DEPLOYED_WORKERS = [
  "ingest",
  "parse",
  "match",
  "ai",
  "cron",
  "share",
  "billing",
  "email",
];

if (process.argv[1]?.endsWith("deploy-worker-list.mjs")) {
  console.log(JSON.stringify(DEPLOYED_WORKERS));
}
