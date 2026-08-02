// Story 7.5 (Task 6, Task 7): the push half of the service worker.
//
// vite-plugin-pwa's default `generateSW` strategy (vite.config.ts) builds
// the whole precache/routing service worker for us; this file is injected
// into it via `workbox.importScripts` — the officially documented way to
// "let Workbox create your top-level service worker file, but... include
// some additional code, such as a push event listener" (workbox-build's own
// doc comment for that option), without switching the whole build to the
// `injectManifest` strategy for the sake of two listeners.
//
// The Worker side (`workers/cron/webPush.ts`) sends an EMPTY-PAYLOAD push —
// see that story's Dev Notes, "The webPush.ts design decision": RFC 8291's
// application-payload encryption is not implemented there (no test vectors
// on hand to check a hand-rolled aes128gcm implementation against), so
// `event.data` below is always empty, by design. This listener shows a
// fixed, generic notification rather than attempting to parse a payload
// that will never arrive. A future story adding real payload encryption
// needs no schema change (`push_subscriptions` already stores
// `p256dh`/`auth`) and would extend this file, not replace it.
self.addEventListener("push", (event) => {
  const title = "MyShadchan";
  const options = {
    body: "You have a new message.",
    icon: "/appIcon/192.png",
    badge: "/appIcon/192.png",
    data: { url: "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Focuses an already-open app window if one exists, otherwise opens a new
// one. There is no per-thread URL to deep-link to (the empty-payload push
// above carries no thread id) — the same "no URL to fabricate" reasoning
// Task 5's email link applies to a `relationship` thread applies here too:
// this opens the app root and lets the in-app unread indicator (AC-1) take
// it from there, rather than guessing a path.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if ("focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      }),
  );
});
