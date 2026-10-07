import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// En desarrollo la API corre aparte; en producción el servidor sirve esta app en el mismo origen.
const API = "http://127.0.0.1:8787";

// Rutas que la navegación sin conexión nunca debe responder con index.html.
const SOLO_RED = /^\/(v1|atajo)\//;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Finanzas",
        short_name: "Finanzas",
        description: "Tu asistente de finanzas personales por voz.",
        lang: "es-MX",
        dir: "ltr",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        theme_color: "#f2f2f7",
        background_color: "#f2f2f7",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [SOLO_RED, /^\/salud$/],
        cleanupOutdatedCaches: true,
        // Recibe las notificaciones push y abre la pantalla de cada una (public/sw-push.js).
        importScripts: ["/sw-push.js"],
        // /atajo/* no tiene ninguna ruta a propósito: si el service worker responde la descarga
        // (aunque sea con NetworkOnly), Safari la guarda como "Finanzas.shortcut.html" y iOS
        // ya no la abre en Atajos. Sin ruta, el navegador la descarga por su cuenta.
        runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.startsWith("/v1/"), handler: "NetworkOnly" }],
      },
    }),
  ],
  server: {
    proxy: { "/v1": API, "/salud": API, "/atajo": API },
  },
  preview: {
    proxy: { "/v1": API, "/salud": API, "/atajo": API },
  },
  build: {
    target: "es2022",
  },
});
