/* مذاكرتي — service worker: الواجهة تُخزَّن للعمل بدون إنترنت.
   غيّر رقم VER عند كل تحديث للتطبيق حتى يصل التحديث للمستخدمين. */
const VER = 'mudhakirati-v9-5';
const SHELL_CACHE = 'shell-' + VER;
const FONT_CACHE = 'fonts-v1';
const SHELL = [
  './', 'index.html', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  'icons/apple-touch-icon-180.png', 'icons/favicon-32.png', 'icons/favicon.svg', 'icons/icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* خطوط جوجل: أعطِ المخزَّن فوراً وحدّثه بالخلفية */
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONT_CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  /* فتح الصفحة: الشبكة أولاً (لتصل التحديثات) ثم النسخة المخزَّنة بلا إنترنت */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => {
        if (r && r.ok) { const copy = r.clone(); caches.open(SHELL_CACHE).then(c => c.put('index.html', copy)); }
        return r;
      }).catch(() => caches.match('index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  /* باقي الملفات (أيقونات...): المخزَّن أولاً */
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(r => {
      if (r && r.ok) { const copy = r.clone(); caches.open(SHELL_CACHE).then(c => c.put(req, copy)); }
      return r;
    }))
  );
});

/* ---- رسائل الصفحة: إشعار نهاية المؤقت حتى لو الصفحة بالخلفية ---- */
let timerT = null;
function pageVisible() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(list => list.some(c => c.visibilityState === 'visible'));
}
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'timer-cancel') { clearTimeout(timerT); timerT = null; return; }
  if (d.type === 'timer') {
    clearTimeout(timerT);
    const ms = d.endAt - Date.now();
    if (!(ms > 0) || ms > 2147483000) return;
    /* أفضل جهد: المتصفح قد يوقف الـ worker قبل الموعد، وعندها تتكفل الصفحة بالإشعار */
    timerT = setTimeout(() => {
      pageVisible().then(vis => {
        if (vis || !self.registration || !self.registration.showNotification) return;
        return self.registration.showNotification(d.title || 'مذاكرتي', {
          body: d.body || '', tag: 'session-end', renotify: true,
          icon: 'icons/apple-touch-icon-180.png', vibrate: [200, 100, 200], data: { url: './' }
        });
      });
    }, ms);
  }
});

/* الضغط على الإشعار يفتح التطبيق أو يرجع له */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow(target);
    })
  );
});
