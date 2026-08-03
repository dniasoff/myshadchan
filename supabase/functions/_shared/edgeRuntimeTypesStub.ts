/**
 * Test-only stand-in for `jsr:@supabase/functions-js/edge-runtime.d.ts`.
 *
 * Every `supabase/functions/**\/index.ts` entrypoint imports that specifier
 * purely for its ambient ` Deno` type declarations (autocomplete/go-to-def in
 * the editor and `tsc`) — it has zero runtime exports. Deno resolves `jsr:`
 * specifiers natively, but Vitest's "functions" project runs these files
 * under Node via Vite, which cannot resolve a `jsr:` module at all. This file
 * is aliased to that specifier in vitest.config.ts (alongside the existing
 * `jsr:@supabase/supabase-js@2` / `npm:tldts` / `npm:pgsql-ast-parser@^12`
 * aliases, the same class of problem) so the bare `import
 * "jsr:@supabase/functions-js/edge-runtime.d.ts";` line resolves to a no-op
 * module instead of failing module resolution — no entrypoint file needs to
 * change to become testable.
 */
export {};
