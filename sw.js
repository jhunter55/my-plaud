const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const SHARED = 'shared-file';
const ASSETS = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Android share sheet -> stash the file, then open the app
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const cache = await caches.open(SHARED);
      let debug = '';
      try {
        const form = await e.request.formData();
        let file = null;
        const seen = [];
        for (const [k, v] of form.entries()) {
          if (typeof v === 'string') seen.push(`${k}: text "${v.slice(0, 120)}"`);
          else { seen.push(`${k}: file ${v.name} (${v.type || 'no type'}, ${v.size} bytes)`); if (!file && v.size) file = v; }
        }
        debug = seen.length ? 'Received: ' + seen.join('; ') : 'The share contained no data.';
        if (file) {
          await cache.put('pending', new Response(file, {
            headers: { 'Content-Type': file.type || 'audio/mp4', 'X-Filename': encodeURIComponent(file.name || 'shared-audio') }
          }));
          debug = '';
        }
      } catch (err) { debug = 'Share handler error: ' + (err && err.message || err); }
      if (debug) await cache.put('debug', new Response(debug));
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }

  // Never cache API calls
  if (url.origin !== location.origin) return;

  if (e.request.method === 'GET') {
    e.respondWith(
      caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
    );
  }
});
