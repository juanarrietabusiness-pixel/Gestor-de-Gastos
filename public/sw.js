/**
 * Service worker.
 *
 * Estrategia deliberadamente conservadora:
 *
 * - El armazon (HTML, JS, CSS) se sirve de cache y se actualiza por detras.
 *   La app abre al instante, incluso sin señal.
 * - Las llamadas a /api NUNCA se cachean. Son plata: mostrar un saldo viejo
 *   como si fuera actual es peor que no mostrar nada.
 */

const CACHE = 'gastos-v1';
const ESENCIALES = ['/', '/icono.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ESENCIALES))
      .then(() => self.skipWaiting())
      .catch(() => {}),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // La API y el WebSocket siempre van a la red, sin excepcion.
  if (url.pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Navegaciones: red primero, cache como respaldo si no hay señal.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copia)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then((r) => r ?? Response.error())),
    );
    return;
  }

  // Estaticos: cache primero, y se refresca por detras para la proxima visita.
  e.respondWith(
    caches.match(e.request).then((cacheado) => {
      const red = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {});
          }
          return res;
        })
        .catch(() => cacheado ?? Response.error());

      return cacheado ?? red;
    }),
  );
});
