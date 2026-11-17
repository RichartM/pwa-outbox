// db-helper.js — Mini-wrapper promisificado de IndexedDB (Vanilla JS, solo Promesas)
// Se usa tanto en la página (window) como en el Service Worker (self).
var DB_NAME = 'outbox-db';
var DB_VERSION = 1;
var STORE = 'outbox';

function abrirDB() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    // Solo se ejecuta al crear la BD o subir de versión: aquí se define el esquema
    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        var store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('estado', 'estado', { unique: false });
      }
    };
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror = function (e) { reject(e.target.error); };
  });
}

// Ejecuta una operación dentro de una transacción y resuelve al completarse
function conStore(modo, operacion) {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, modo); // 'readonly' | 'readwrite'
      var store = tx.objectStore(STORE);
      var resultado;
      var req = operacion(store);
      if (req) { req.onsuccess = function () { resultado = req.result; }; }
      tx.oncomplete = function () { db.close(); resolve(resultado); };
      tx.onerror = function () { db.close(); reject(tx.error); };
      tx.onabort = function () { db.close(); reject(tx.error); };
    });
  });
}

var dbHelper = {
  agregar: function (registro) {
    return conStore('readwrite', function (s) { return s.add(registro); });
  },
  obtenerTodos: function () {
    return conStore('readonly', function (s) { return s.getAll(); });
  },
  obtenerPendientes: function () {
    return conStore('readonly', function (s) {
      return s.index('estado').getAll('pendiente');
    });
  },
  eliminar: function (id) {
    return conStore('readwrite', function (s) { return s.delete(id); });
  },
  limpiar: function () {
    return conStore('readwrite', function (s) { return s.clear(); });
  }
};
