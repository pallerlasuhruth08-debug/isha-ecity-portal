// Service worker for Web Push. Kept minimal — no offline caching, just push +
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
