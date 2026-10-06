import { existsSync, readdirSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// En la nube de pruebas el Chromium está en PLAYWRIGHT_BROWSERS_PATH con otra versión;
// en una Mac con `playwright install` no hace falta nada de esto.
function chromiumLocal(): string | undefined {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return undefined;
  const dirs = readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort();
  const dir = dirs.at(-1);
  const exe = dir ? `${base}/${dir}/chrome-linux/chrome` : undefined;
  return exe && existsSync(exe) ? exe : undefined;
}

const PUERTO = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://127.0.0.1:${PUERTO}`,
    browserName: "chromium",
    // iPhone de 6.1"/6.3": 390×844
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    // El service worker atendería /v1 antes que page.route.
    serviceWorkers: "block",
    launchOptions: { executablePath: chromiumLocal() },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js build && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${PUERTO} --strictPort`,
    url: `http://127.0.0.1:${PUERTO}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
