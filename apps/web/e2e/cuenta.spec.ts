import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion, TOKEN } from "./api-falsa";
import { ponerEstado } from "./api-falsa-cuenta";

// Cuenta (nombre de saludo, usuario y código para entrar), entrar e instalar el Atajo con ellos, y Sistema.

const CODIGO = "clave-segura-1";

function conCodigo(api = new ApiFalsa()) {
  api.cuenta.tieneCodigo = true;
  api.cuenta.codigo = CODIGO;
  return api;
}

async function sinSesion(page: Page, api: ApiFalsa) {
  await page.clock.setFixedTime(new Date("2026-10-06T12:30:00-06:00"));
  await api.instalar(page);
  return api;
}

test.describe("Cuenta en Ajustes", () => {
  test("cambiar el nombre con el que te saludo", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#ajustes");
    await expect(page.getByRole("heading", { name: "Pedro Ramírez" })).toBeVisible();

    await page.getByRole("button", { name: "Cómo te saludo" }).click();
    const hoja = page.getByRole("dialog", { name: "Cómo te saludo" });
    const campo = hoja.getByLabel("Nombre");
    await expect(campo).toHaveValue("Pedro Ramírez");
    const guardar = hoja.getByRole("button", { name: "Guardar" });
    await expect(guardar).toBeDisabled(); // sin cambios
    await campo.fill("   ");
    await expect(guardar).toBeDisabled();
    await campo.fill(" Pedrito ");
    await guardar.click();

    await expect(hoja).toHaveCount(0);
    await expect(page.getByText("Nombre guardado")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pedrito" })).toBeVisible();
    expect(api.de("PATCH", "/v1/yo")[0]?.cuerpo).toEqual({ nombre: "Pedrito" });

    await page.goto("/#inicio");
    await expect(page.getByText("Hola, Pedrito")).toBeVisible();
  });

  test("cambiar el usuario: pistas, 409 y cómo queda", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#ajustes");
    const fila = page.getByRole("button", { name: /^Usuario/ });
    await expect(fila).toContainText("pedro");
    await fila.click();

    const hoja = page.getByRole("dialog", { name: "Usuario" });
    const campo = hoja.getByLabel("Usuario");
    const guardar = hoja.getByRole("button", { name: "Guardar" });
    await expect(campo).toHaveValue("pedro");

    await campo.fill("pe");
    await expect(hoja.getByRole("alert")).toHaveText("Mínimo 3 caracteres.");
    await expect(guardar).toBeDisabled();
    await campo.fill("pedro ramírez");
    await expect(hoja.getByRole("alert")).toHaveText("Solo letras, números, punto, guion o guion bajo.");
    await campo.fill("p".repeat(25));
    await expect(hoja.getByRole("alert")).toHaveText("Máximo 24 caracteres.");
    await expect(guardar).toBeDisabled();

    // Sin acentos y en minúsculas, como lo guarda el servidor.
    await campo.fill("José.Pérez");
    await expect(hoja.getByText("Quedará como «jose.perez».")).toBeVisible();
    await expect(guardar).toBeEnabled();

    await campo.fill("Ocupado");
    await guardar.click();
    await expect(hoja.getByRole("alert")).toHaveText("Ese usuario ya lo tiene alguien más.");
    await expect(hoja).toBeVisible();
    expect(api.de("PATCH", "/v1/yo")[0]?.cuerpo).toEqual({ usuario: "ocupado" });

    // Escribir quita el error del servidor.
    await campo.fill("José.Pérez");
    await expect(hoja.getByRole("alert")).toHaveCount(0);
    await campo.press("Enter");
    await expect(hoja).toHaveCount(0);
    await expect(page.getByText("Usuario guardado")).toBeVisible();
    await expect(fila).toContainText("jose.perez");
    expect(api.cuenta.usuario).toBe("jose.perez");
  });

  test("crear, cambiar y quitar el código para entrar", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#ajustes");
    await expect(page.getByText("puedes entrar desde cualquier iPhone o reinstalar el Atajo")).toBeVisible();
    await expect(page.getByRole("button", { name: "Quitar código" })).toHaveCount(0);
    await page.getByRole("button", { name: "Crear código para entrar" }).click();

    const hoja = page.getByRole("dialog", { name: "Crear código" });
    await expect(hoja.getByText("Con tu usuario pedro y este código")).toBeVisible();
    const codigo = hoja.getByLabel("Código", { exact: true });
    const otraVez = hoja.getByLabel("Confirmar");
    const guardar = hoja.getByRole("button", { name: "Guardar" });
    await expect(codigo).toHaveAttribute("type", "password");
    await expect(codigo).toHaveAttribute("autocomplete", "new-password");

    await codigo.fill("corto");
    await expect(hoja.getByRole("alert")).toHaveText("Mínimo 8 caracteres.");
    await expect(guardar).toBeDisabled();

    // Mostrar enseña los dos campos; Ocultar los vuelve a tapar.
    await hoja.getByRole("button", { name: "Mostrar código" }).click();
    await expect(codigo).toHaveAttribute("type", "text");
    await expect(otraVez).toHaveAttribute("type", "text");
    await hoja.getByRole("button", { name: "Ocultar código" }).click();
    await expect(codigo).toHaveAttribute("type", "password");

    await codigo.fill(CODIGO);
    await otraVez.fill("clave-segura"); // a medias todavía no es error
    await expect(hoja.getByRole("alert")).toHaveCount(0);
    await expect(guardar).toBeDisabled();
    await otraVez.fill("clave-segura-2");
    await expect(hoja.getByRole("alert")).toHaveText("Los códigos no coinciden.");
    await expect(guardar).toBeDisabled();

    // Uno obvio: lo rechaza el servidor (400).
    await codigo.fill("12345678");
    await otraVez.fill("12345678");
    await guardar.click();
    await expect(hoja.getByRole("alert")).toHaveText("Ese código es muy fácil de adivinar. Elige otro.");
    expect(api.cuenta.tieneCodigo).toBe(false);

    await codigo.fill(CODIGO);
    await otraVez.fill(CODIGO);
    await guardar.click();
    await expect(hoja).toHaveCount(0);
    await expect(page.getByText("Código creado")).toBeVisible();
    expect(api.de("PUT", "/v1/yo/codigo").map((p) => p.cuerpo)).toEqual([{ codigo: "12345678" }, { codigo: CODIGO }]);
    expect(api.cuenta.codigo).toBe(CODIGO);
    // Nunca se vuelve a mostrar.
    expect(await page.content()).not.toContain(CODIGO);

    // Cambiarlo.
    await page.getByRole("button", { name: "Cambiar código para entrar" }).click();
    const cambiar = page.getByRole("dialog", { name: "Cambiar código" });
    await expect(cambiar.getByLabel("Código", { exact: true })).toHaveValue("");
    await cambiar.getByLabel("Código", { exact: true }).fill("otra-clave-larga");
    await cambiar.getByLabel("Confirmar").fill("otra-clave-larga");
    await cambiar.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Código cambiado")).toBeVisible();
    expect(api.cuenta.codigo).toBe("otra-clave-larga");

    // Quitarlo pide confirmación.
    await page.getByRole("button", { name: "Quitar código" }).click();
    const alerta = page.getByRole("alertdialog");
    await expect(alerta).toContainText("¿Quitar tu código?");
    await alerta.getByRole("button", { name: "Cancelar" }).click();
    expect(api.de("DELETE", "/v1/yo/codigo")).toHaveLength(0);
    await page.getByRole("button", { name: "Quitar código" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Quitar" }).click();
    await expect(page.getByText("Código quitado")).toBeVisible();
    await expect(page.getByRole("button", { name: "Crear código para entrar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Quitar código" })).toHaveCount(0);
    expect(api.de("DELETE", "/v1/yo/codigo")).toHaveLength(1);
    expect(api.cuenta.tieneCodigo).toBe(false);
  });

  test("con código, cerrar sesión recuerda que se puede volver con usuario y código", async ({ page }) => {
    await prepararSesion(page, conCodigo());
    await page.goto("/#ajustes");
    await page.getByRole("button", { name: /Cerrar sesión en este dispositivo/ }).click();
    await expect(page.getByRole("alertdialog")).toContainText("usa tu usuario y tu código");
  });

  test("un servidor viejo: sin usuario, sin código y sin estado, sin avisos de error", async ({ page }) => {
    const api = new ApiFalsa();
    ponerEstado(api, null);
    await prepararSesion(page, api);
    // GET /v1/yo como antes: el usuario solo trae id y nombre.
    await page.route(/\/v1\/yo$/, (route) =>
      route.request().method() !== "GET"
        ? route.fallback()
        : route.fulfill({
            json: {
              usuario: { id: "usr-1", nombre: "Pedro Ramírez" },
              dispositivo: { id: "dis-1", nombre: "iPhone 17 Pro Max" },
              dispositivos: api.dispositivos,
              moneda: "MXN",
              zonaHoraria: "America/Mexico_City",
              hoy: "2026-10-06",
            },
          }),
    );
    await page.goto("/#ajustes");
    await expect(page.getByRole("heading", { name: "Pedro Ramírez" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cómo te saludo" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Usuario/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /código para entrar/ })).toHaveCount(0);
    const sistema = page.getByRole("region", { name: "Sistema" });
    await expect(sistema).toHaveText(/Actualiza el servidor para ver su estado/);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  });
});

test.describe("Sistema en Ajustes", () => {
  test("servidor, versión, IA lista y nada pendiente", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#ajustes");
    const sistema = page.getByRole("region", { name: "Sistema" });
    await expect(sistema.getByText("Encendido desde hace 3 horas")).toBeVisible();
    await expect(sistema.getByText("En línea")).toHaveCount(1); // el punto verde, para VoiceOver
    await expect(sistema.getByText("3f9c2ab")).toBeVisible();
    await expect(sistema.getByText("Desplegada hace 5 días")).toBeVisible();
    await expect(sistema.getByText("qwen3-14b")).toBeVisible();
    await expect(sistema.getByText("Lista")).toBeVisible();
    await expect(sistema.getByText("Nada pendiente")).toBeVisible();
    expect(api.de("GET", "/v1/estado")[0]?.autorizacion).toBe(`Bearer ${TOKEN}`);
  });

  test("IA disponible pero sin cargar, y dictados en cola", async ({ page }) => {
    const api = new ApiFalsa();
    ponerEstado(api, { ia: { cargada: false }, cola: { pendientes: 2, conError: 1 } });
    await prepararSesion(page, api);
    await page.goto("/#ajustes");
    const sistema = page.getByRole("region", { name: "Sistema" });
    await expect(sistema.getByText("Se carga al hablar")).toBeVisible();
    await expect(sistema.getByText("2 en proceso · 1 con error")).toBeVisible();
  });

  test("IA no disponible", async ({ page }) => {
    const api = new ApiFalsa();
    ponerEstado(api, { ia: { disponible: false, cargada: false }, cola: { conError: 3 } });
    await prepararSesion(page, api);
    await page.goto("/#ajustes");
    const sistema = page.getByRole("region", { name: "Sistema" });
    await expect(sistema.getByText("No disponible")).toBeVisible();
    await expect(sistema.getByText("3 con error")).toBeVisible();
    await expect(sistema.getByText("en proceso")).toHaveCount(0);
  });

  test("un servidor sin /v1/estado (404) lo dice en voz baja", async ({ page }) => {
    const api = new ApiFalsa();
    ponerEstado(api, null);
    await prepararSesion(page, api);
    await page.goto("/#ajustes");
    await expect(page.getByRole("region", { name: "Sistema" })).toHaveText(/Actualiza el servidor para ver su estado/);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  });
});

test.describe("Entrar con usuario y código", () => {
  test("401, 429 y luego entra", async ({ page }) => {
    const api = await sinSesion(page, conCodigo());
    await page.goto("/");
    await page.getByRole("button", { name: "Entrar con usuario y código" }).click();
    await expect(page.getByRole("heading", { name: "Entra a Finanzas" })).toBeVisible();
    await expect(page.locator("#codigo")).toHaveCount(0); // ya no están las casillas de invitación

    const entrar = page.getByRole("button", { name: "Entrar", exact: true });
    await expect(entrar).toBeDisabled();
    await page.getByLabel("Usuario").fill("Pedro");
    await page.getByLabel("Código", { exact: true }).fill("no-es-este");
    await expect(page.getByLabel("Código", { exact: true })).toHaveAttribute("type", "password");
    await expect(page.getByLabel("Dispositivo")).toHaveValue("iPhone");
    await entrar.click();
    await expect(page.getByRole("alert")).toHaveText("Usuario o código incorrectos.");
    expect(await page.evaluate(() => localStorage.getItem("fa_token"))).toBeNull();

    await page.getByLabel("Usuario").fill("muchos");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await entrar.click();
    await expect(page.getByRole("alert")).toHaveText("Demasiados intentos. Espera unos minutos.");

    await page.getByLabel("Usuario").fill("Pedro ");
    await page.getByLabel("Código", { exact: true }).fill(CODIGO);
    await page.getByLabel("Dispositivo").fill("iPhone 13");
    await page.getByLabel("Código", { exact: true }).press("Enter");

    await expect(page.getByRole("heading", { name: /Octubre/ })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("fa_token"))).toBe(TOKEN);
    const peticiones = api.de("POST", "/v1/entrar");
    expect(peticiones).toHaveLength(3);
    expect(peticiones[2]?.cuerpo).toEqual({ usuario: "pedro", codigo: CODIGO, dispositivo: "iPhone 13" });
    expect(peticiones.map((p) => p.autorizacion)).toEqual([undefined, undefined, undefined]);
    expect(page.url()).toContain("#inicio");
  });

  test("se puede volver al código de invitación", async ({ page }) => {
    await sinSesion(page, new ApiFalsa());
    await page.goto("/");
    await page.getByRole("button", { name: "Entrar con usuario y código" }).click();
    await page.getByRole("button", { name: "Usar un código de invitación" }).click();
    await page.locator("#codigo").fill("dev456");
    await expect(page.getByText("Agregar este dispositivo a la cuenta de")).toContainText("Pedro");
  });
});

test.describe("Instalar el Atajo con usuario y código", () => {
  test("401, 501 con reintento y descarga, sin tocar la sesión", async ({ page }) => {
    const api = await sinSesion(page, conCodigo());
    await page.goto("/instalar");
    await page.getByRole("button", { name: "Instalar con usuario y código" }).click();
    await expect(page.getByText("Entra con tu usuario y tu código para instalarlo.")).toBeVisible();
    await expect(page.locator("#codigo")).toHaveCount(0);

    const instalar = page.getByRole("button", { name: "Instalar el Atajo" });
    await expect(instalar).toBeDisabled();
    await page.getByLabel("Usuario").fill("pedro");
    await page.getByLabel("Código", { exact: true }).fill("no-es-este");
    await instalar.click();
    await expect(page.getByRole("alert")).toHaveText("Usuario o código incorrectos.");

    api.fallasFirma = 1;
    await page.getByLabel("Código", { exact: true }).fill(CODIGO);
    await instalar.click();
    await expect(page.getByRole("alert")).toHaveText("Tu Mac no pudo firmar el Atajo. Vuelve a intentarlo.");

    const descarga = page.waitForEvent("download");
    await page.getByRole("button", { name: "Reintentar" }).click();
    const archivo = await descarga;
    const origen = new URL(page.url()).origin;
    expect(archivo.url()).toMatch(new RegExp(`^${origen}/atajo/[\\w-]+\\.shortcut$`));
    await expect(page.getByText("Ya casi está. Sigue estos 3 pasos:")).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir la app Finanzas" })).toBeVisible();

    const peticiones = api.de("POST", "/v1/atajo/entrar");
    expect(peticiones).toHaveLength(3);
    expect(peticiones[2]?.cuerpo).toEqual({ usuario: "pedro", codigo: CODIGO, servidor: origen });
    expect(peticiones.map((p) => p.autorizacion)).toEqual([undefined, undefined, undefined]);
    expect(api.de("POST", "/v1/atajo/canjear")).toHaveLength(0);
    expect(await page.evaluate(() => localStorage.getItem("fa_token"))).toBeNull();
  });

  test("429 no ofrece reintentar y se puede volver al código de invitación", async ({ page }) => {
    await sinSesion(page, new ApiFalsa());
    await page.goto("/instalar");
    await page.getByRole("button", { name: "Instalar con usuario y código" }).click();
    await page.getByLabel("Usuario").fill("muchos");
    await page.getByLabel("Código", { exact: true }).fill("lo-que-sea-1");
    await page.getByRole("button", { name: "Instalar el Atajo" }).click();
    await expect(page.getByRole("alert")).toHaveText("Demasiados intentos. Espera unos minutos.");
    await expect(page.getByRole("button", { name: "Reintentar" })).toHaveCount(0);

    await page.getByRole("button", { name: "Usar un código de invitación" }).click();
    await page.locator("#codigo").fill("dev456");
    await expect(page.getByText("Hola, Pedro.")).toBeVisible();
  });
});
