// ============================================================
// sw.js — Service Worker
// Handles: app-shell caching, offline fallback, background sync
// of recognition history that was created while offline.
// ============================================================

const CACHE_VERSION = 'signspeak-v1';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Everything needed to boot the app with no network.
// Model weights are cached at runtime instead (they're large and
// versioned by TF.js/MediaPipe internally).
const APP_SHELL_FILES = [
  './',
  './index.html',
  './login.html',
  './signup.html',
  './forgot-password.html',
  './dashboard.html',
  './history.html',
  './learn.html',
  './settings.html',
  './offline.html',
  './manifest.json',
  './css/base.css',
  './css/components.css',
  './css/layout.css',
  './css/auth.css',
  './js/env.js',
  './js/supabase.js',
  './js/utils.js',
  './js/auth.js',
  './js/camera.js',
  './js/speech.js',
  './js/recognition.js',
  './js/history.js',
  './js/settings.js',
  './js/learn.js',
  './js/dashboard.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

// ------------------------------------------------------------
// INSTALL — pre-cache the app shell
// ------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

// ------------------------------------------------------------
// ACTIVATE — clean up old cache versions
// ------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('signspeak-') && key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ------------------------------------------------------------
// FETCH strategy:
//  - Supabase API calls: network-only (never cache user data)
//  - CDN model/library assets (tfjs, mediapipe, supabase-js): cache-first, long-lived
//  - App shell files: stale-while-revalidate
//  - Navigation requests offline: fall back to offline.html
// ------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return; // don't touch POST/PUT to Supabase

  // Never cache Supabase API traffic — always hit the network.
  if (url.hostname.endsWith('.supabase.co')) {
    return; // let the browser handle it natively
  }

  // CDN libraries & ML model files: cache-first (they're versioned/immutable)
  const isCdnAsset =
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('tfhub.dev') ||
    url.hostname.includes('storage.googleapis.com') ||
    url.hostname.includes('cdn.jsdelivr.net');

  if (isCdnAsset) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch (err) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // Same-origin navigation (page loads)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./offline.html'))
    );
    return;
  }

  // Same-origin app shell files: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(APP_SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
  }
});

// ------------------------------------------------------------
// BACKGROUND SYNC
// dashboard.js registers a 'sync-history' tag whenever a
// recognition write to Supabase fails because the device is
// offline. The pending rows are queued in IndexedDB (see
// js/history.js -> queuePendingWrite). When connectivity
// returns, the browser fires this event and we flush the queue.
// ------------------------------------------------------------
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-history') {
    event.waitUntil(flushPendingHistory());
  }
});

async function flushPendingHistory() {
  const clientsList = await self.clients.matchAll({ type: 'window' });
  // Ask an open tab to do the actual Supabase write, since the
  // service worker doesn't hold auth session state itself.
  clientsList.forEach((client) => {
    client.postMessage({ type: 'FLUSH_PENDING_HISTORY' });
  });
}

// Allow the page to trigger an immediate skip-waiting after
// an update prompt ("New version available — Reload").
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
