import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

// __WB_MANIFEST is replaced at build time (vite-plugin-pwa's injectManifest) with
// the list of hashed build assets -- this is what makes the app shell installable
// and load offline. Kept in the same file as the pre-existing Web Push handlers
// below rather than a separate generated worker, so both keep working from one
// registration.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Navigations (the SPA shell itself) -- try the network first so a signed-in user
// always gets the latest build when online, falling back to the precached shell
// the moment the network is unavailable.
registerRoute(({ request }) => request.mode === 'navigate', new NetworkFirst({
  cacheName: 'pages',
  plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 7 * 24 * 3600 })],
}))

// The OCR engine for "Scan attendance sheet" — the tesseract.js script, its WASM
// core, and the English traineddata — is fetched from a CDN on first use and is
// tens of megabytes. That download happens at a venue, on venue wi-fi, which is
// the worst possible moment for it. CacheFirst means it is paid for exactly once
// per device and every later scan works instantly, including with no signal at
// all. These files are immutable per version, so cache-first is safe: a version
// bump changes the URL.
registerRoute(
  ({ url }) => /(^|\.)jsdelivr\.net$|(^|\.)unpkg\.com$|(^|\.)projectnaptha\.com$/.test(url.hostname),
  new CacheFirst({
    cacheName: 'ocr-engine',
    plugins: [new ExpirationPlugin({ maxEntries: 24, maxAgeSeconds: 180 * 24 * 3600, purgeOnQuotaError: true })],
  }),
)

// Stays in the "waiting" state after install (registerType: 'prompt') until the
// client explicitly asks to activate -- see PwaUpdatePrompt's updateServiceWorker(true),
// which posts this message after the user taps "Reload". Avoids silently swapping
// the app out from under someone mid-form.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Service worker for Web Push. No offline caching, just push +
// notification click routing. The phase-notify edge function sends {title,body,url,tag}.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'Volunteer Care', body: event.data && event.data.text() } }
  const title = data.title || 'Volunteer Care'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: './favicon.svg',
      badge: './favicon.svg',
      tag: data.tag,
      data: { url: data.url || './' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || './'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ('focus' in w) return w.focus() }
      if (self.clients.openWindow) return self.clients.openWindow(target)
    }),
  )
})
