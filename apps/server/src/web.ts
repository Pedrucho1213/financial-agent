// Sirve la PWA compilada (apps/web/dist) desde el mismo servidor: una sola dirección para todo.
import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import type { Context } from "hono";

const SIN_CACHE = "no-cache";
// Vite pone un hash en el nombre de lo que hay en assets/, así que nunca cambia.
const INMUTABLE = "public, max-age=31536000, immutable";

export function servirApp(carpeta: string) {
  const raiz = normalize(carpeta);
  const indice = join(raiz, "index.html");
  return async (c: Context) => {
    let ruta: string;
    try {
      ruta = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.text("Dirección inválida.", 400);
    }
    if (ruta.startsWith("/v1/") || ruta.startsWith("/atajo/")) return c.json({ error: "No existe." }, 404);
    if (!existsSync(indice)) {
      return c.text("La app no está compilada. En la Mac corre: bun run web:build", 503);
    }
    const archivo = normalize(join(raiz, ruta));
    // Nada fuera de la carpeta de la app, aunque pidan "/../".
    const dentro = archivo === raiz || archivo.startsWith(raiz + sep);
    if (dentro && existsSync(archivo) && statSync(archivo).isFile()) {
      const cache = ruta.startsWith("/assets/") ? INMUTABLE : SIN_CACHE;
      return new Response(Bun.file(archivo), { headers: { "Cache-Control": cache } });
    }
    // Cualquier otra ruta es de la app (#inicio, /?codigo=...): entrega index.html.
    if (/\.[a-z0-9]+$/i.test(ruta)) return c.text("No existe.", 404);
    return new Response(Bun.file(indice), { headers: { "Cache-Control": SIN_CACHE, "Content-Type": "text/html; charset=utf-8" } });
  };
}
