import { execSync } from "node:child_process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// En desarrollo la API corre aparte; en producción el servidor sirve esta app en el mismo origen.
const API = "http://127.0.0.1:8787";

// Rutas que la navegación sin conexión nunca debe responder con index.html.
const SOLO_RED = /^\/(v1|atajo)\//;

function git(argumentos: string) {
  try {
    return execSync(`git ${argumentos}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

// La versión de esta compilación: la fecha del commit en hora de México (2026.10.14.1520) y el commit.
// La app la lleva adentro y el servidor sirve la misma en /version.json; si no coinciden, hay una nueva.
function versionApp() {
  const commit = git("rev-parse --short HEAD");
  const fecha = new Date(git("log -1 --format=%cI") || Date.now());
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(fecha)
      .map((x) => [x.type, x.value]),
  );
  const numero = `${p.year}.${p.month}.${p.day}.${p.hour}${p.minute}`;
  return { numero, commit: commit || "local", fecha: fecha.toISOString() };
}

const VERSION = versionApp();

/** Deja /version.json junto a la app (fuera de la caché del service worker: no es .js ni .png). */
function archivoVersion(): Plugin {
  const json = JSON.stringify(VERSION);
  return {
    name: "version-app",
    configureServer(servidor) {
      servidor.middlewares.use("/version.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(json);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: json });
    },
  };
}

export default defineConfig({
  define: {
    __VERSION_APP__: JSON.stringify(VERSION),
  },
  plugins: [
    react(),
    archivoVersion(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Lo registra lib/actualizacion.ts: busca versiones al volver a la app y recarga en un momento seguro.
      injectRegister: false,
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
