const CACHE_NAME = 'ciclus-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/locales/it.json',
  '/locales/en.json'
  // Aggiungi qui anche l'icona e i file audio se vuoi che funzionino offline
];

// Installazione e salvataggio in cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

// Intercettazione richieste di rete
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Ritorna la risorsa dalla cache se esiste, altrimenti la scarica dalla rete
        return response || fetch(event.request);
      })
  );
});