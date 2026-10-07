// Notificaciones push de Finanzas. El service worker que arma vite-plugin-pwa lo carga con importScripts.
// El servidor manda {titulo, cuerpo, url, etiqueta}; al tocarla se abre esa ruta de la app.

self.addEventListener("push", (evento) => {
  let datos = {};
  try {
    datos = evento.data ? evento.data.json() : {};
  } catch {
    datos = { cuerpo: evento.data ? evento.data.text() : "" };
  }
  const titulo = datos.titulo || "Finanzas";
  evento.waitUntil(
    self.registration.showNotification(titulo, {
      body: datos.cuerpo || "",
      tag: datos.etiqueta || undefined,
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      lang: "es-MX",
      data: { url: datos.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  // Solo rutas de esta app.
  const destino = new URL(evento.notification.data?.url || "/", self.location.origin);
  const url = destino.origin === self.location.origin ? destino.href : self.location.origin + "/";
  evento.waitUntil(
    (async () => {
      const abiertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const app = abiertas.find((c) => new URL(c.url).origin === self.location.origin);
      if (app) {
        // La app ya abierta cambia de pantalla sola (ver lib/notificaciones.ts); navigate() la recargaría.
        app.postMessage({ tipo: "fa:abrir", url });
        await app.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
