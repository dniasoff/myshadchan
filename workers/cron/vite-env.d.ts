/// <reference types="vite/client" />

// `noTenantTableAccess.guard.test.ts` (Story 7.5 F3 review fix) uses
// `import.meta.glob(..., { query: "?raw" })`, the same `?raw` source-scan
// idiom `src/vite-env.d.ts` already types for the app project's own guard
// tests (`references/entitlementGate.guard.test.ts` and its siblings).
// `tsconfig.workers.json` has no such reference of its own — this file is
// the local one, scoped to `workers/cron/**` (this dispatch's own owned
// path set), rather than widening the root tsconfig for every Worker.
