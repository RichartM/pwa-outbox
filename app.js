// app.js — Interfaz + Patrón Outbox
var API_URL = 'https://jsonplaceholder.typicode.com/posts';
var SYNC_TAG = 'sync-outbox';
var soportaSync = 'serviceWorker' in navigator && 'SyncManager' in window;

var $ = function (id) { return document.getElementById(id); };

function log(msg) {
  $('log').textContent = new Date().toLocaleTimeString() + ' — ' + msg + '\n' + $('log').textContent;
}

function pintarEstadoRed() {
  var el = $('estadoRed');
  el.textContent = navigator.onLine ? 'En línea' : 'Sin conexión';
  el.className = 'estado ' + (navigator.onLine ? 'online' : 'offline');
}

function renderizarBandeja() {
  return dbHelper.obtenerTodos().then(function (items) {
    $('contador').textContent = items.length;
    $('lista').innerHTML = '';
    items.forEach(function (it) {
      var li = document.createElement('li');
      li.innerHTML = '<span><strong></strong><br><small></small></span>';
      li.querySelector('strong').textContent = it.payload.title;
      li.querySelector('small').textContent = it.estado + ' · ' + new Date(it.fecha).toLocaleString();
      var b = document.createElement('button');
      b.textContent = '✕'; b.className = 'peligro';
      b.onclick = function () { dbHelper.eliminar(it.id).then(renderizarBandeja); };
      li.appendChild(b);
      $('lista').appendChild(li);
    });
  });
}

// Si falla la red, el envío se encola como 'pendiente'
function encolar(payload) {
  return dbHelper.agregar({ payload: payload, estado: 'pendiente', fecha: Date.now() })
    .then(function () {
      log('Sin red: guardado en la bandeja de salida.');
      return registrarSync();
    })
    .then(renderizarBandeja);
}

function enviarPost(payload) {
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function (r) {
    if (!r.ok) { throw new Error('HTTP ' + r.status); }
    return r.json();
  });
}

// Registra la etiqueta de Background Sync (o no hace nada si no hay soporte)
function registrarSync() {
  if (!soportaSync) { return Promise.resolve(); }
  return navigator.serviceWorker.ready.then(function (reg) {
    return reg.sync.register(SYNC_TAG);
  }).then(function () {
    log('Background Sync registrado (' + SYNC_TAG + ').');
  }).catch(function (e) { log('No se pudo registrar sync: ' + e.message); });
}

// Respaldo para navegadores sin SyncManager (Safari/iOS): sincroniza desde la página
function sincronizarDesdePagina() {
  return dbHelper.obtenerPendientes().then(function (pendientes) {
    if (!pendientes.length) { return; }
    return Promise.all(pendientes.map(function (it) {
      return enviarPost(it.payload).then(function () { return dbHelper.eliminar(it.id); });
    })).then(function () {
      log('Respaldo "online": ' + pendientes.length + ' envío(s) sincronizado(s).');
    });
  }).catch(function (e) { log('Sincronización fallida: ' + e.message); })
    .then(renderizarBandeja);
}

$('formulario').addEventListener('submit', function (e) {
  e.preventDefault();
  var payload = { title: $('titulo').value, body: $('cuerpo').value, userId: 1 };
  e.target.reset();
  if (!navigator.onLine) { encolar(payload); return; }
  enviarPost(payload)
    .then(function (data) { log('Enviado al servidor (id ' + data.id + ').'); })
    .catch(function () { return encolar(payload); });
});

$('btnPurgar').addEventListener('click', function () {
  dbHelper.limpiar().then(function () { log('Bandeja purgada.'); return renderizarBandeja(); });
});

$('btnSync').addEventListener('click', function () {
  if (soportaSync) { registrarSync(); } else { sincronizarDesdePagina(); }
});

window.addEventListener('online', function () {
  pintarEstadoRed();
  // Degradación elegante: solo la página sincroniza si no existe SyncManager
  if (!soportaSync) { sincronizarDesdePagina(); }
});
window.addEventListener('offline', pintarEstadoRed);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(function () { log('Service Worker registrado.'); })
    .catch(function (e) { log('Error al registrar SW: ' + e.message); });

  // Mensajes del SW tras sincronizar en segundo plano
  navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.tipo === 'SYNC_COMPLETADO') {
      log('Service Worker sincronizó ' + e.data.enviados + ' envío(s).');
      renderizarBandeja();
    }
  });
}

$('soporteSync').textContent = soportaSync ? 'Background Sync ✔' : 'Respaldo con evento online';
pintarEstadoRed();
renderizarBandeja();
