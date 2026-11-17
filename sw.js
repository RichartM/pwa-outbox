// sw.js — Cache del app shell + motor de sincronización (Background Sync)
importScripts('./db-helper.js');

var CACHE = 'outbox-shell-v1';
var API_URL = 'https://jsonplaceholder.typicode.com/posts';
var SYNC_TAG = 'sync-outbox';
var SHELL = ['./', './index.html', './app.js', './db-helper.js', './manifest.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Cache first para el shell; las peticiones POST pasan directo a la red
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') { return; }
  e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request); }));
});

function avisarClientes(mensaje) {
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(function (clientes) {
    clientes.forEach(function (c) { c.postMessage(mensaje); });
  });
}

function sincronizarOutbox() {
  return dbHelper.obtenerPendientes().then(function (pendientes) {
    return Promise.all(pendientes.map(function (it) {
      return fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(it.payload)
      }).then(function (r) {
        if (!r.ok) { throw new Error('HTTP ' + r.status); }
        return dbHelper.eliminar(it.id);
      });
    })).then(function () {
      return avisarClientes({ tipo: 'SYNC_COMPLETADO', enviados: pendientes.length });
    });
  });
  // Si algo falla, la promesa se rechaza y el navegador reintenta el sync más tarde
}

self.addEventListener('sync', function (e) {
  if (e.tag === SYNC_TAG) { e.waitUntil(sincronizarOutbox()); }
});
