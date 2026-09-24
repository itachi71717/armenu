// ARMenu service worker — handles Web Push notifications.
// Registered by staff/kitchen/portal pages after the user opts in.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'ARMenu', body: (event.data && event.data.text()) || '' }; }
  const title = data.title || 'ARMenu';
  const opts = {
    body: data.body || '',
    icon: data.icon || '/favicon.svg',
    badge: '/favicon.svg',
    tag: data.tag || 'armenu',
    renotify: true,
    vibrate: [120, 60, 120],
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // If any window is already at the target URL, focus it
    for (const c of clients) {
      if (c.url.endsWith(url)) return c.focus();
    }
    // Otherwise open a new one
    return self.clients.openWindow(url);
  })());
});
