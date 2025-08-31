/**
 * Service Worker for SCORM Tester
 * 
 * Provides basic caching and offline functionality for the application.
 * This is a minimal service worker to prevent registration errors.
 */

const CACHE_NAME = 'scorm-tester-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/src/styles/main.css',
  '/src/renderer/app.js'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        self.postMessage({ type: 'log', level: 'info', message: 'SW: Cache opened' });
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        self.postMessage({ type: 'log', level: 'error', message: 'SW: Cache failed to open', data: error });
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            self.postMessage({ type: 'log', level: 'info', message: 'SW: Deleting old cache', data: cacheName });
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});