// Story 10.1 (Task 1): the hand-written service worker `injectManifest`
// needs (`vite.config.ts`). This is the top-level service worker file now —
// there is no longer a Workbox-generated one to layer things onto — so it
// takes over everything `generateSW` + `registerType: "autoUpdate"` used to
// give for free (precaching, immediate activation) plus Story 7.5's push
// listeners, plus the one thing `generateSW` could never do: a `fetch`
// handler.
//
// That handler is why the switch happened at all. AC 1's Web Share Target
// Level 2 (`public/manifest.json`'s `method: "POST"`) delivers the shared
// payload as an HTTP POST with a `multipart/form-data` body. A static HTML
// page (the old `public/share-target.html` GET shim) cannot read a POST
// body — only a service worker's `fetch` event handler, or a real server,
// can, and this static Vite SPA has no server in the request path for
// `/share-target`.
//
// `tsconfig.app.json` (which type-checks every other file under `src/`)
// sets `lib: ["ES2022", "DOM", "DOM.Iterable"]` — no `"webworker"`, because
// the DOM and WebWorker libs declare conflicting, mutually-exclusive
// globals (`self` chief among them) and cannot coexist in one TS program.
// Every other file in `src/` genuinely runs in a window, so widening the
// whole app project's `lib` (or giving this one file its own tsconfig
// project) for the sake of one file was the wrong trade. Instead, this file
// declares exactly the handful of service-worker-only members it actually
// touches — `skipWaiting`, `__WB_MANIFEST`, `importScripts`, the `fetch`
// event's `request`/`respondWith` — and narrows `self` to that shape via a
// single `as unknown as` cast (`.claude/rules/typescript.md`'s sanctioned
// pattern for an external shape TS can't otherwise see), rather than
// widening any global type or reaching for `any`.
import { clientsClaim } from "workbox-core";
import { precacheAndRoute } from "workbox-precaching";

declare function importScripts(...urls: string[]): void;

interface FetchEvent extends Event {
  readonly request: Request;
  respondWith(response: Response | PromiseLike<Response>): void;
}

interface PrecacheManifestEntry {
  url: string;
  revision: string | null;
}

interface ServiceWorkerSelf {
  __WB_MANIFEST: Array<PrecacheManifestEntry | string>;
  skipWaiting: () => void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
}

const sw = self as unknown as ServiceWorkerSelf;

// Story 7.5 (Task 6, Task 7): the push / `notificationclick` listeners.
// `importScripts` is the classic-worker global this bundle still supports —
// vite-plugin-pwa's `injectManifest` strategy bundles this file as a plain
// script (not an ES module worker), so the browser's native
// `importScripts()` is available at runtime exactly as it was when
// `vite.config.ts`'s old `workbox.importScripts: ["push-sw.js"]` option
// injected the same file into the Workbox-generated worker. `public/
// push-sw.js` itself is unchanged and keeps shipping via Vite's normal
// `public/` copy. The relative, unquoted-slash form (not "/push-sw.js")
// matches `scripts/verify-push-sw-build.mjs`'s existing check byte-for-byte
// — it was written against the exact string `generateSW` used to produce
// and still checks for that literal in the built `dist/sw.js`.
importScripts("push-sw.js");

// workbox-build's `injectManifest` step (`vite.config.ts`) finds its
// insertion point by searching the BUILT bundle for the literal text
// `self.__WB_MANIFEST` (workbox-build's `injectionPoint` default) — a plain
// string search, not an aliasing-aware one. Referencing it through `sw`
// (or any other local name) hides that literal once minification renames
// the alias, and the build fails outright: "Unable to find a place to
// inject the manifest." (Proven — this exact failure reproduced with the
// `sw.__WB_MANIFEST` form during this story's implementation.) Every OTHER
// member access below safely goes through `sw`; this one call must
// reference `self` directly, inline, instead.
precacheAndRoute((self as unknown as ServiceWorkerSelf).__WB_MANIFEST);

// autoUpdate's behavior, now explicit: `injectManifest` doesn't wire
// immediate activation for you the way `generateSW` + `registerType:
// "autoUpdate"` did.
sw.skipWaiting();
clientsClaim();

// The share-target cache: keyed per-share so a share landing on `/#/share`
// (Response.redirect below) can look its own files back up, and cleared by
// `ShareTarget.tsx` once read so a page refresh never re-imports stale
// files. `ShareTarget.tsx` is a separate build (the app bundle, not this
// service-worker bundle) so it cannot import these constants directly —
// its own copy of the same three literals is commented back to this file;
// keep both in sync if either changes.
//
// The key MUST be a path-like string starting with "/": `Cache.put()`/
// `.match()` construct a `Request` from a bare string key by parsing it as a
// URL. A key of the form "<uuid>:manifest" parses as an ABSOLUTE url whose
// scheme is everything before the first ":" — a v4 UUID's hex/hyphen
// characters are all valid URL-scheme characters, so the browser reads the
// whole UUID as the scheme and rejects it: "Request scheme '<uuid>' is
// unsupported." (reproduced live, `e2e/share-target.spec.ts`, against a real
// Chromium Cache API — no unit test catches this, since it needs the
// browser's real URL parser, not a mock). A leading "/" makes it an
// absolute-PATH reference instead, resolved against this worker's own
// origin, which is always a supported http(s) scheme.
const SHARE_TARGET_CACHE = "share-target-inbox";
const shareTargetManifestKey = (shareKey: string) =>
  `/share-target-inbox/${shareKey}/manifest`;
const shareTargetFileKey = (shareKey: string, index: number) =>
  `/share-target-inbox/${shareKey}/${index}`;

sw.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(handleShareTarget(event));
  }
});

/** One entry per shared file, alongside its bytes, so `ShareTarget.tsx` can
 * rebuild a real `File` (name + type) from what the Cache API gives back —
 * a stored `Response` carries bytes and a content-type, never a filename. */
type SharedFileManifestEntry = { name: string; type: string };

async function handleShareTarget(event: FetchEvent): Promise<Response> {
  const formData = await event.request.formData();
  const title = String(formData.get("title") ?? "");
  const text = String(formData.get("text") ?? "");
  const url = String(formData.get("url") ?? "");
  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File);

  const params = new URLSearchParams();
  if (title) params.set("title", title);
  if (text) params.set("text", text);
  if (url) params.set("url", url);

  if (files.length > 0) {
    const shareKey = crypto.randomUUID();
    const cache = await caches.open(SHARE_TARGET_CACHE);
    const manifest: SharedFileManifestEntry[] = files.map((file) => ({
      name: file.name,
      type: file.type,
    }));
    await Promise.all([
      cache.put(
        shareTargetManifestKey(shareKey),
        new Response(JSON.stringify(manifest)),
      ),
      ...files.map((file, index) =>
        cache.put(shareTargetFileKey(shareKey, index), new Response(file)),
      ),
    ]);
    params.set("shareKey", shareKey);
  }

  return Response.redirect(`/#/share?${params.toString()}`, 303);
}
