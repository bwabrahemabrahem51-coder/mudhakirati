/* مذاكرتي — service worker: الواجهة تُخزَّن للعمل بدون إنترنت.
   غيّر رقم VER عند كل تحديث للتطبيق حتى يصل التحديث للمستخدمين. */
const VER = 'mudhakirati-v9-39';
const SHELL_CACHE = 'shell-' + VER;
const FONT_CACHE = 'fonts-v1';
const CFG_CACHE = 'cfg-v1';   /* إعدادات التذكير اليومي (تبقى بعد إيقاف الـ worker) */
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
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== FONT_CACHE && k !== CFG_CACHE).map(k => caches.delete(k))))
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

  /* فتح الصفحة: النسخة المخزَّنة فوراً (أسرع ما يمكن) وتتحدّث بالخلفية للفتحة الجاية */
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(SHELL_CACHE).then(async c => {
      /* نسخة التلفاز (index-tv.html) تُخزَّن باسمها حتى لا تُستبدل بنسخة التلفون */
      const key = /index-tv\.html$/.test(url.pathname) ? 'index-tv.html' : 'index.html';
      const hit = (await c.match(key)) || (key === 'index.html' ? await c.match('./') : null);
      const net = fetch(req).then(r => { if (r && r.ok) c.put(key, r.clone()); return r; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || Response.error();
    }));
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
const cfgGet = () => caches.open(CFG_CACHE).then(c => c.match('cfg')).then(r => r ? r.json() : {}).catch(() => ({}));
const cfgSet = o => caches.open(CFG_CACHE).then(c => c.put('cfg', new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } }))).catch(() => {});
const p2 = n => (n < 10 ? '0' : '') + n;
const todayKey = () => { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
const nowHM = () => { const d = new Date(); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
/* التذكير اليومي بالخلفية (periodicSync): أفضل جهد، والصفحة تتكفل به لو كانت مفتوحة */
function remindCheck() {
  return cfgGet().then(cfg => {
    if (!cfg.on || cfg.last === todayKey() || nowHM() < (cfg.time || '18:00')) return;
    return pageVisible().then(vis => {
      if (vis || !self.registration || !self.registration.showNotification) return;
      cfg.last = todayKey();
      return cfgSet(cfg).then(() => self.registration.showNotification(cfg.title || 'مذاكرتي', {
        body: cfg.body || '', tag: 'daily-reminder', icon: 'icons/apple-touch-icon-180.png', vibrate: [200, 100, 200], data: { url: './' }
      }));
    });
  });
}
self.addEventListener('periodicsync', e => { if (e.tag === 'daily-reminder') e.waitUntil(remindCheck()); });
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'remind-cfg') {
    e.waitUntil(cfgGet().then(old => {
      const same = old.on === d.on && old.time === d.time;
      return cfgSet({ on: !!d.on, time: d.time || '18:00', title: d.title, body: d.body, last: same ? old.last : '' });
    }));
    return;
  }
  if (d.type === 'remind-done') {
    e.waitUntil(cfgGet().then(old => { old.last = todayKey(); return cfgSet(old); }));
    return;
  }
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
