// app.js — Interfaz, envío resiliente (Patrón Outbox) y reconexión
const ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';

// Fragmento G: recepción de mensajes del Service Worker + registro del SW
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });

  navigator.serviceWorker.register('./sw.js')
    .then((reg) => console.log('[SW] Registrado con scope:', reg.scope))
    .catch((error) => console.error('[SW] Error al registrar:', error));
}

// Indicador visual de conectividad
function actualizarIndicadorRed(){
  const badge = document.getElementById('badge-red');
  if (navigator.onLine) {
    badge.textContent = 'En Línea';
    badge.className = 'badge online';
  } else {
    badge.textContent = 'Sin Conexión';
    badge.className = 'badge offline';
  }
}

// READ: lee IndexedDB y dibuja la cola en pantalla
function renderizarColaOutbox(){
  return obtenerTodosLosRegistros().then((registros) => {
    const lista = document.getElementById('lista-outbox');
    lista.innerHTML = '';

    if (registros.length === 0) {
      const vacio = document.createElement('li');
      vacio.className = 'vacio';
      vacio.textContent = 'La bandeja está vacía.';
      lista.appendChild(vacio);
      return;
    }

    registros.forEach((item) => {
      const li = document.createElement('li');

      const info = document.createElement('div');
      const titulo = document.createElement('strong');
      titulo.textContent = item.titulo;
      const hora = document.createElement('span');
      hora.className = 'hora';
      hora.textContent = new Date(item.fechaCreacion).toLocaleTimeString('es-MX');
      info.appendChild(titulo);
      info.appendChild(hora);

      const estado = document.createElement('span');
      estado.className = 'estado ' + item.estado;
      estado.textContent = item.estado;

      li.appendChild(info);
      li.appendChild(estado);
      lista.appendChild(li);
    });
  });
}

// CREATE: intenta el POST; si falla la red, encola en IndexedDB como 'pendiente'
function procesarEnvioReporte(datosFormulario){
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: datosFormulario.titulo, body: datosFormulario.descripcion })
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      // Envío exitoso en vivo: registrar en bitácora local como sincronizado
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => {
          // Detección de soporte para Background Sync API
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              });
          }
        });
    })
    .then(() => {
      // Actualizar la lista visual en ambos escenarios
      return renderizarColaOutbox();
    });
}

// UPDATE (fallback para navegadores sin SyncManager, ej. Safari/iOS)
function sincronizarPendientesFallback(){
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      // Convertir cada registro pendiente en una promesa de envío + actualización
      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      // Esperar a que todos los reenvíos concluyan
      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

// Conexión del formulario (submit)
document.getElementById('form-incidencia').addEventListener('submit', (e) => {
  e.preventDefault();
  const datos = {
    titulo: document.getElementById('titulo').value.trim(),
    descripcion: document.getElementById('descripcion').value.trim()
  };
  procesarEnvioReporte(datos).then(() => e.target.reset());
});

// DELETE: purga los registros ya sincronizados
document.getElementById('btn-purgar').addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter((item) => item.estado === 'sincronizado');
      return Promise.all(sincronizados.map((item) => eliminarRegistro(item.id)));
    })
    .then(() => renderizarColaOutbox())
    .catch((error) => console.error('[Outbox] Error al purgar:', error));
});

// Fragmento F: prevención de condiciones de carrera en el evento online
window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Degradación elegante: solo sincronizar desde UI si NO hay Background Sync (ej. Safari/iOS)
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

// Al cargar la página: READ inicial (rescata los registros guardados aunque se haya cerrado la pestaña)
actualizarIndicadorRed();
renderizarColaOutbox();
