import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import createHtmlPlugin from "vite-plugin-simple-html";

import { resolveStack } from "./scripts/stack-env.mjs";

// https://vitejs.dev/config/
export default defineConfig({
  /**
   * One optimised-dependency cache per STACK_ID (scripts/stack-env.mjs).
   *
   * Vite's default is a single `node_modules/.vite` for the whole checkout, so
   * every concurrently running dev/e2e server shared it. Each re-optimisation
   * rewrites `deps/` with freshly hashed chunk filenames and deletes the old
   * ones — which are exactly the files the *other* servers' already-loaded
   * pages are still fetching, so those pages 404 mid-test. Ports, databases and
   * Docker projects were already stack-scoped; this was the last host-global
   * left, and the one that actually broke parallel e2e runs.
   *
   * Stack 0 (STACK_ID unset) resolves to "node_modules/.vite", i.e. Vite's own
   * default, so nothing changes off the parallel path.
   */
  cacheDir: resolveStack(process.env.STACK_ID).cacheDir,
  server: {
    port: 5173,
    host: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    /**
     * Off unless explicitly requested — `ANALYZE=1 npm run build`.
     *
     * It wrote `./dist/stats.html` on EVERY build, which meant a 1.55 MB
     * bundle-analysis report was deployed publicly (confirmed: HTTP 200 at
     * /stats.html) and, because `globPatterns` below sweeps `html`, pushed
     * into the service-worker precache of every first-time visitor — the
     * single largest entry, 27% of the whole precache, for a file nobody
     * looks at outside a performance session.
     *
     * The old `open:` expression was also inverted in practice: `NODE_ENV`
     * is "production" on Vercel and unset locally, so `!== "CI"` was TRUE
     * for both and every production build tried to spawn a browser.
     */
    ...(process.env.ANALYZE
      ? [visualizer({ open: true, filename: "./dist/stats.html" })]
      : []),
    createHtmlPlugin({
      minify: true,
      inject: {
        data: {
          mainScript: `src/main.tsx`,
        },
      },
    }),
    VitePWA({
      registerType: "autoUpdate",
      // Story 10.1 (Task 1): `generateSW` (the default strategy) auto-builds
      // the whole precache/routing service worker and leaves no room for a
      // custom `fetch` handler — exactly what AC 1's Web Share Target Level
      // 2 (`method: "POST"`) needs, since a POST body can only be read by a
      // service worker's own `fetch` listener (see `src/sw.ts`'s header for
      // why). `injectManifest` swaps in the hand-written `src/sw.ts` below,
      // still getting the precache manifest injected at `self.__WB_MANIFEST`.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        // The exact glob/size-cap `workbox.globPatterns` /
        // `maximumFileSizeToCacheInBytes` configured under `generateSW` —
        // `injectManifest`'s config is where they live under this strategy,
        // per vite-plugin-pwa's own docs.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        /**
         * Everything here is deliberately NOT part of the app shell, and
         * precaching it made a first visit download ~2 MB it does not need.
         *
         * The three library chunks are lazy BY DESIGN — `PdfPreview.tsx` and
         * `docxSanitizer.ts` reach pdfjs, mammoth and DOMPurify only through
         * `await import()`, and `attachments/docxSanitizer.guard.test.ts`
         * fails the build if that ever regresses to a static import.
         * Precaching them silently undid that: the point of the split is that
         * a visitor who never opens a PDF never pays for pdfjs. Precaching a
         * document RENDERER is doubly pointless offline, because the document
         * itself lives in Supabase storage behind a signed URL and needs the
         * network regardless.
         *
         * `mammoth-*` only has a stable name because of the `manualChunks`
         * rule below — Rollup otherwise names it after mammoth's own entry
         * file, `index.js`, making it indistinguishable from the app entry
         * chunk. A naive `index-*.js` pattern here would have excluded the
         * application itself and broken the PWA.
         *
         * `appIcon/**` (35 files, ~400 KB) is fetched by the browser's own
         * install machinery from `manifest.json`, not by the app — and you
         * cannot install a PWA while offline. `img/**` is two files, neither
         * referenced by any runtime code (`adding-users.png` belongs to the
         * docs site; `empty.svg` is referenced nowhere at all).
         *
         * NEVER add `mjs` to `globPatterns`: `pdf.worker.min-*.mjs` is 1.26 MB
         * and escapes precaching today only because that extension is absent.
         */
        globIgnores: [
          "stats.html",
          "**/mammoth-*.js",
          "**/pdf-*.js",
          "**/purify.es-*.js",
          "**/pdf.worker*",
          "appIcon/**",
          "img/**",
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB
      },
      // Story 7.5's push/notificationclick listeners used to reach the
      // generated worker via `workbox.importScripts: ["push-sw.js"]` — the
      // documented `generateSW`-only mechanism for adding a push listener
      // without a hand-written service worker. `injectManifest` has no
      // `importScripts` option of its own (there is no longer a
      // Workbox-generated file to inject into), so simply dropping this
      // block would silently kill Epic 7's push notifications on every next
      // deploy with nothing failing loudly. `src/sw.ts` ports the same
      // call forward directly, as `importScripts("push-sw.js")` (relative,
      // no leading slash — the exact literal
      // `scripts/verify-push-sw-build.mjs` checks for in the built
      // `dist/sw.js`; review fix F7, Story 10.1, corrected this comment,
      // which used to say "/push-sw.js") — see that file — so
      // `public/push-sw.js` (unaffected by this switch; Vite's `public/`
      // copy still ships it) keeps firing.
      manifest: false, // Use existing manifest.json from public/
    }),
  ],
  define:
    process.env.NODE_ENV === "production" && process.env.VITE_SUPABASE_URL
      ? {
          "import.meta.env.VITE_IS_DEMO": JSON.stringify(
            process.env.VITE_IS_DEMO,
          ),
          "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
            process.env.VITE_SUPABASE_URL,
          ),
          "import.meta.env.VITE_SB_PUBLISHABLE_KEY": JSON.stringify(
            process.env.VITE_SB_PUBLISHABLE_KEY,
          ),
          "import.meta.env.VITE_INBOUND_EMAIL": JSON.stringify(
            process.env.VITE_INBOUND_EMAIL,
          ),
          "import.meta.env.VITE_ATTACHMENTS_BUCKET": JSON.stringify(
            process.env.VITE_ATTACHMENTS_BUCKET,
          ),
          // Story 7.5 review fix (F1): without this, setting
          // VITE_VAPID_PUBLIC_KEY in Vercel does nothing — this `define`
          // block, not `.env.*` files, is the only channel by which a
          // VITE_* value reaches the client in a deployed build (see the
          // five entries above it). workers/cron/wrangler.toml documents
          // the paired name on the Worker side (VAPID_PUBLIC_KEY).
          "import.meta.env.VITE_VAPID_PUBLIC_KEY": JSON.stringify(
            process.env.VITE_VAPID_PUBLIC_KEY,
          ),
          // Story 9.5 (Task 6): `sharing/shareClient.ts` fetches the
          // deployed `share/` Worker directly (never through the
          // dataProvider — the recipient has no session). Same landmine as
          // VITE_VAPID_PUBLIC_KEY above: without this line, setting the var
          // in Vercel does nothing, because this `define` block is the
          // only channel a VITE_* value reaches a deployed build through.
          "import.meta.env.VITE_SHARE_WORKER_URL": JSON.stringify(
            process.env.VITE_SHARE_WORKER_URL,
          ),
          // Story 12.4: `billing/SubscribeButton.tsx` and
          // `ManageSubscriptionButton.tsx` POST to the deployed `billing/`
          // Worker directly (Stripe Checkout and the customer portal are not
          // dataProvider calls). Third time this landmine has been stepped on,
          // after VITE_VAPID_PUBLIC_KEY and VITE_SHARE_WORKER_URL above:
          // without this line the built bundle resolves the var to `undefined`
          // and every Subscribe click POSTs to `undefined/checkout`, no matter
          // what is set in Vercel.
          "import.meta.env.VITE_BILLING_WORKER_URL": JSON.stringify(
            process.env.VITE_BILLING_WORKER_URL,
          ),
        }
      : undefined,
  base: "./",
  esbuild: {
    keepNames: true,
  },
  build: {
    /**
     * Off. ~14 MB of maps were built and uploaded on every deploy and served
     * to nobody: Vercel returns 403 for any `.map` (verified — a NONEXISTENT
     * `.map` also 403s while a nonexistent `.js` 200s, so the block is by
     * extension, not by absence). Nothing consumes them either — no Sentry,
     * Bugsnag, Rollbar, Datadog or LogRocket anywhere in the repo. A private
     * app's readable source should not sit one platform-policy change away
     * from public. Use `ANALYZE=1` for bundle questions instead.
     */
    sourcemap: false,
    rollupOptions: {
      output: {
        /**
         * Give mammoth a stable chunk name. Rollup names a chunk after its
         * entry module, and mammoth's is `lib/index.js`, so the docx renderer
         * shipped as `assets/index-<hash>.js` — impossible to tell apart from
         * the app's own entry chunk by filename. That is what makes it
         * excludable from the precache above without also excluding the app.
         */
        manualChunks(id: string) {
          if (id.includes("node_modules/mammoth")) return "mammoth";
          return undefined;
        },
      },
    },
  },
  resolve: {
    preserveSymlinks: true,
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
