// Genera los PNG que pide iOS y el manifiesto a partir de public/icono.svg.
// Uso: bun scripts/iconos.mjs  (o node). Usa el Chromium de Playwright; no instala nada.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(raiz, "public/icono.svg"), "utf8");

function chromiumLocal() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return undefined;
  const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
  const exe = dir && join(base, dir, "chrome-linux", "chrome");
  return exe && existsSync(exe) ? exe : undefined;
}

const salidas = [
  { archivo: "apple-touch-icon.png", tam: 180 },
  { archivo: "pwa-192.png", tam: 192 },
  { archivo: "pwa-512.png", tam: 512 },
  { archivo: "pwa-maskable-512.png", tam: 512 },
];

const navegador = await chromium.launch({ executablePath: chromiumLocal() });
const pagina = await navegador.newPage({ deviceScaleFactor: 1 });
for (const { archivo, tam } of salidas) {
  await pagina.setViewportSize({ width: tam, height: tam });
  await pagina.setContent(
    `<html><body style="margin:0;background:#0060df">${svg.replace("<svg ", `<svg width="${tam}" height="${tam}" style="display:block" `)}</body></html>`,
  );
  await pagina.screenshot({ path: join(raiz, "public", archivo), clip: { x: 0, y: 0, width: tam, height: tam } });
  console.log(`public/${archivo} (${tam}x${tam})`);
}
await navegador.close();
