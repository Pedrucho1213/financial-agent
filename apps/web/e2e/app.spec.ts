import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ApiFalsa, comoAppDeInicio, HOY, portapapelesFalso, prepararSesion, TOKEN } from "./api-falsa";

const PASOS_DESCARGA = [/Toca «Descargar»/, /Archivos › Descargas/, /En Atajos toca «Agregar atajo»/];

test.describe("Entrar", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-06T12:30:00-06:00"));
  });

  test("registro con código de usuario nuevo desde ?codigo=", async ({ page }) => {
    const api = new ApiFalsa();
    await api.instalar(page);
    await portapapelesFalso(page);
    await page.goto("/?codigo=abc123");

    // En Safari de iPhone, primero se instala la app: el código no se gasta aquí.
    await expect(page.getByRole("heading", { name: "Instala Finanzas en tu iPhone" })).toBeVisible();
    await expect(page.locator("[data-codigo]")).toHaveText("ABC123");
    await expect(page.getByRole("list", { name: "Pasos para instalarla" }).getByRole("listitem")).toHaveText([
      /Toca Compartir/,
      /Elige «Agregar a inicio»/,
      /Abre Finanzas desde tu pantalla de inicio y pega el código/,
    ]);
    await page.getByRole("button", { name: "Copiar código" }).click();
    await expect(page.getByRole("button", { name: "Copiado" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("ABC123");
    expect(api.de("POST", "/v1/registro")).toHaveLength(0);

    // "Usar en Safari" lo canjea aquí mismo, como antes.
    await page.getByRole("button", { name: "Usar en Safari" }).click();

    // El código llega en mayúsculas y se revisa solo.
    await expect(page.locator("#codigo")).toHaveValue("ABC123");
    await expect(page.getByText("Código válido")).toBeVisible();
    await expect(page.getByLabel("Dispositivo")).toHaveValue("iPhone");
    const continuar = page.getByRole("button", { name: "Continuar" });
    await expect(continuar).toBeDisabled();

    await page.getByLabel("Tu nombre").fill("Pedro");
    await continuar.click();

    await expect(page.getByRole("heading", { name: /Octubre/ })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("fa_token"))).toBe(TOKEN);
    expect(api.de("POST", "/v1/registro")[0]?.cuerpo).toEqual({ codigo: "ABC123", nombre: "Pedro", dispositivo: "iPhone" });
    expect(page.url()).not.toContain("codigo=");
  });

  test("en la app de inicio, «Pegar código» llena las casillas y ?codigo= va directo", async ({ page }) => {
    await new ApiFalsa().instalar(page);
    await comoAppDeInicio(page);
    await portapapelesFalso(page, "Te invito a Finanzas: https://finanzas.mi-red.ts.net/?codigo=dev456");
    await page.goto("/");
    await page.getByRole("button", { name: "Pegar código" }).click();
    await expect(page.locator("#codigo")).toHaveValue("DEV456");
    await expect(page.getByText("Agregar este dispositivo a la cuenta de")).toContainText("Pedro");
    await expect(page.getByRole("button", { name: "Pegar código" })).toHaveCount(0);

    await page.goto("/?codigo=ABC123");
    await expect(page.getByText("Código válido")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Instala Finanzas/ })).toHaveCount(0);
  });

  test("otro dispositivo de una cuenta existente", async ({ page }) => {
    const api = new ApiFalsa();
    await api.instalar(page);
    await page.goto("/");
    await page.locator("#codigo").fill("dev456");
    await expect(page.getByText("Agregar este dispositivo a la cuenta de")).toContainText("Pedro");
    await expect(page.getByLabel("Tu nombre")).toHaveCount(0);
    await page.getByLabel("Dispositivo").fill("iPhone 13");
    await page.getByRole("button", { name: "Agregar dispositivo" }).click();
    await expect(page.getByRole("heading", { name: /Octubre/ })).toBeVisible();
    expect(api.de("POST", "/v1/registro")[0]?.cuerpo).toEqual({ codigo: "DEV456", dispositivo: "iPhone 13" });
  });

  test("errores claros para 404, 410 y 429", async ({ page }) => {
    await new ApiFalsa().instalar(page);
    await page.goto("/");
    const codigo = page.locator("#codigo");
    await codigo.fill("NOEXIS");
    await expect(page.getByText("Ese código no existe")).toBeVisible();
    await codigo.fill("VIEJO1");
    await expect(page.getByText("ya se usó o venció")).toBeVisible();
    await codigo.fill("MUCHOS");
    await expect(page.getByText("Demasiados intentos")).toBeVisible();
  });

  test("un 401 borra el token y regresa a Entrar", async ({ page }) => {
    await new ApiFalsa().instalar(page);
    await page.addInitScript(() => localStorage.setItem("fa_token", "fa_vencido"));
    await page.goto("/#inicio");
    await expect(page.getByRole("heading", { name: "Entra a Finanzas" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("fa_token"))).toBeNull();
  });
});

test.describe("Entrar en computadora", () => {
  test.use({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    isMobile: false,
    hasTouch: false,
  });
  test("un enlace con ?codigo= va directo a entrar", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-06T12:30:00-06:00"));
    await new ApiFalsa().instalar(page);
    await page.goto("/?codigo=abc123");
    await expect(page.getByRole("heading", { name: "Entra a Finanzas" })).toBeVisible();
    await expect(page.getByText("Código válido")).toBeVisible();
    await expect(page.getByLabel("Dispositivo")).toHaveValue("Mac");
    await expect(page.getByRole("button", { name: "Pegar código" })).toHaveCount(0);
  });
});

test.describe("Inicio", () => {
  test("tarjetas, comparación y las dos gráficas", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Octubre/ })).toBeVisible();
    const gastado = page.getByRole("region", { name: "Gastado" });
    await expect(gastado).toContainText("$16,754.70");
    await expect(gastado).toContainText("20% más que al 6 de septiembre");
    await expect(gastado).toContainText("$269.50"); // hoy
    await expect(page.getByRole("region", { name: "Ingresado" })).toContainText("$18,750.00");
    await expect(page.getByRole("region", { name: "Balance" })).toContainText("+$1,995.30");
    await expect(page.getByText("2 movimientos por revisar")).toBeVisible();

    // Dona y barras (ECharts con SVG).
    const dona = page.getByRole("img", { name: "Gastos por categoría" });
    const barras = page.getByRole("img", { name: /últimos 6 meses/ });
    await expect(dona.locator("svg path").first()).toBeAttached();
    await expect(barras.locator("svg path").first()).toBeAttached();
    expect(await barras.locator("svg path").count()).toBeGreaterThan(10);

    await expect(page.getByText("Mayores gastos")).toBeVisible();
    await expect(page.getByText("Lo que más repites")).toBeVisible();
    await expect(page.getByText("Smart Fit")).toBeVisible();
    expect(api.de("GET", "/v1/tablero")[0]?.consulta.get("mes")).toBe(HOY.slice(0, 7));

    // Mes anterior.
    await page.getByRole("button", { name: "Mes anterior" }).click();
    await expect(page.getByRole("heading", { name: /Septiembre/ })).toBeVisible();
    await expect(page).toHaveURL(/#inicio\?mes=2026-09/);
  });

  test("tocar una categoría lleva a Movimientos filtrado", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/");
    await page.getByRole("button", { name: /^Comida/ }).click();
    await expect(page).toHaveURL(/#movimientos\?.*categoria=cat-comida/);
    await expect(page.getByText("Walmart")).toBeVisible();
    const ultima = api.de("GET", "/v1/movimientos").at(-1);
    expect(ultima?.consulta.get("categoria_id")).toBe("cat-comida");
    expect(ultima?.consulta.get("tipo")).toBe("gasto");
  });

  test("el aviso de por revisar abre la lista con revisar=1", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/");
    await page.getByText("2 movimientos por revisar").click();
    await expect(page.getByText("Farmacia San Pablo")).toBeVisible();
    await expect(page.getByText("2 movimientos")).toBeVisible();
    expect(api.de("GET", "/v1/movimientos").at(-1)?.consulta.get("revisar")).toBe("1");
  });
});

test.describe("Movimientos", () => {
  test("crear, editar y eliminar con deshacer", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#movimientos");
    await expect(page.getByText("16 movimientos")).toBeVisible();

    // Crear con el botón +.
    await page.getByRole("button", { name: "Agregar movimiento" }).click();
    const hoja = page.getByRole("dialog");
    await expect(hoja.getByText("Nuevo movimiento")).toBeVisible();
    await hoja.locator("#monto").fill("249.90");
    await hoja.getByLabel("Categoría").selectOption({ label: "Restaurantes" });
    await hoja.getByLabel("Comercio").fill("Tacos El Güero");
    await hoja.getByRole("button", { name: "Agregar" }).click();
    await expect(hoja).toBeHidden();
    await expect(page.getByRole("button", { name: /^Tacos El Güero/ })).toBeVisible();
    expect(api.de("POST", "/v1/movimientos")[0]?.cuerpo).toEqual({
      tipo: "gasto",
      monto: 249.9,
      fecha: HOY,
      categoria_id: "cat-restaurantes",
      comercio: "Tacos El Güero",
    });

    // Editar: solo se manda lo que cambió.
    await page.getByRole("button", { name: /^Starbucks/ }).click();
    await expect(hoja.getByText("gasté 85 en un café en el Starbucks de Reforma")).toBeVisible();
    await hoja.locator("#monto").fill("95");
    await hoja.getByLabel("Comercio").fill("Starbucks Reforma");
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(hoja).toBeHidden();
    await expect(page.getByRole("button", { name: /^Starbucks Reforma/ })).toBeVisible();
    const patch = api.de("PATCH", /\/v1\/movimientos\//)[0];
    expect(patch?.ruta).toBe("/v1/movimientos/mov-001");
    expect(patch?.cuerpo).toEqual({ monto: 95, comercio: "Starbucks Reforma" });

    // Las categorías del editor dependen del tipo.
    await page.getByRole("button", { name: /^Starbucks Reforma/ }).click();
    await hoja.getByRole("radio", { name: "Ingreso" }).click();
    const opciones = await hoja.getByLabel("Categoría").locator("option").allTextContents();
    expect(opciones).toContain("Sueldo");
    expect(opciones).not.toContain("Café");

    // Eliminar desde la hoja y deshacer.
    await hoja.getByRole("button", { name: "Eliminar movimiento" }).click();
    await expect(hoja).toBeHidden();
    await expect(page.getByRole("button", { name: /^Starbucks Reforma/ })).toHaveCount(0);
    const aviso = page.locator("[data-sonner-toast]").filter({ hasText: "Eliminado" });
    await expect(aviso).toBeVisible();
    await aviso.getByRole("button", { name: "Deshacer" }).click();
    await expect.poll(() => api.de("POST", "/v1/deshacer").length).toBe(1);
    await expect(page.getByText("Listo, regresé")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Starbucks Reforma/ })).toBeVisible();
    expect(api.de("DELETE", "/v1/movimientos/mov-001")).toHaveLength(1);
  });

  test("solo queda un «Deshacer»: el de lo último que se borró", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#movimientos");
    const hoja = page.getByRole("dialog");
    for (const nombre of ["Starbucks", "Walmart"]) {
      await page.getByRole("button", { name: new RegExp(`^${nombre}`) }).first().click();
      await hoja.getByRole("button", { name: "Eliminar movimiento" }).click();
      await expect(hoja).toBeHidden();
    }
    const avisos = page.locator("[data-sonner-toast]").filter({ hasText: "Eliminado" });
    await expect(avisos).toHaveCount(1);
    await expect(avisos).toContainText("Walmart");
    await avisos.getByRole("button", { name: "Deshacer" }).click();
    await expect(page.getByText("Listo, regresé Walmart.")).toBeVisible();
    expect(api.de("POST", "/v1/deshacer")).toHaveLength(1);
  });

  test("filtros, búsqueda y cargar más", async ({ page }) => {
    const api = new ApiFalsa();
    // 60 movimientos más en octubre para paginar.
    for (let i = 0; i < 60; i++) {
      api.movimientos.push({ ...api.movimientos[0]!, id: `extra-${i}`, comercio: `Comercio ${i}`, fecha: "2026-10-01" });
    }
    await prepararSesion(page, api);
    await page.goto("/#movimientos");
    await expect(page.getByText("76 movimientos")).toBeVisible();
    await page.getByRole("button", { name: /Cargar más/ }).click();
    await expect(page.getByRole("button", { name: /Cargar más/ })).toHaveCount(0);
    const paginas = api.de("GET", "/v1/movimientos").map((p) => p.consulta.get("offset"));
    expect(paginas).toContain("50");

    await page.getByRole("radio", { name: "Ingresos" }).click();
    await expect(page.getByText("1 movimiento", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/tipo=ingreso/);

    await page.getByRole("radio", { name: "Todos" }).click();
    await page.getByLabel("Buscar").fill("oxxo");
    await expect(page.getByText("3 movimientos")).toBeVisible();
    expect(api.de("GET", "/v1/movimientos").at(-1)?.consulta.get("texto")).toBe("oxxo");

    await page.getByLabel("Mes").selectOption("todo");
    await expect(page).toHaveURL(/mes=todo/);
    const ultima = api.de("GET", "/v1/movimientos").at(-1);
    expect(ultima?.consulta.get("desde")).toBe("2000-01-01");
  });

  test("deslizar a la izquierda muestra Eliminar", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#movimientos");
    const fila = page.getByRole("button", { name: /^Uber/ });
    await expect(fila).toBeVisible();
    const caja = await fila.boundingBox();
    if (!caja) throw new Error("sin caja");
    const y = caja.y + caja.height / 2;
    // Gesto táctil simulado con CDP (Chromium).
    const cdp = await page.context().newCDPSession(page);
    const tocar = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    await tocar("touchStart", caja.x + caja.width - 30);
    for (let i = 1; i <= 8; i++) await tocar("touchMove", caja.x + caja.width - 30 - i * 15);
    await tocar("touchEnd", 0);
    await page.waitForTimeout(400);
    const eliminar = fila.locator("xpath=..").locator("button", { hasText: "Eliminar" });
    await expect(eliminar).toBeVisible();
    await eliminar.click();
    await expect.poll(() => api.de("DELETE", /\/v1\/movimientos\//).length).toBe(1);
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Eliminado" })).toBeVisible();
  });
});

test.describe("Chat", () => {
  test("respuesta pendiente con esperar y luego consulta la entrada", async ({ page }) => {
    const api = new ApiFalsa();
    api.hablar = [
      202,
      {
        respuesta: "Dame un momento más, sigo revisando tus cuentas.",
        conversacion_id: "conv-7",
        acciones: [],
        pendiente: true,
        esperar: true,
      },
    ];
    api.entradas = [
      { estado: "procesando" },
      {
        estado: "listo",
        respuesta: "Esta semana llevas $1,234.50 en gastos, sobre todo en Comida.",
        conversacion_id: "conv-7",
        acciones: [{ herramienta: "consultar_gastos", argumentos: { periodo: "esta_semana" }, resultado: { total: "1234.50" } }],
      },
    ];
    await prepararSesion(page, api);
    await page.goto("/#chat");
    await page.getByRole("button", { name: "¿Cómo voy este mes?" }).click();

    await expect(page.getByText("Esta semana llevas $1,234.50")).toBeVisible();
    await expect(page.getByText("Revisó tus gastos")).toBeVisible();

    const hablar = api.de("POST", "/v1/hablar")[0]?.cuerpo as Record<string, unknown>;
    expect(hablar.texto).toBe("¿Cómo voy este mes?");
    expect(hablar.espera_ms).toBe(60000);
    expect(String(hablar.client_id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(hablar.conversacion_id).toBeUndefined();
    const consultas = api.de("GET", /\/v1\/entradas\//);
    expect(consultas).toHaveLength(2);
    expect(consultas[0]?.ruta).toBe(`/v1/entradas/${hablar.client_id}`);
    expect(consultas[0]?.consulta.get("esperar_ms")).toBe("45000");

    // El siguiente mensaje sigue la misma conversación.
    api.hablar = [200, { respuesta: "Anotado: $85.00 en Café.", conversacion_id: "conv-7", acciones: [{ herramienta: "registrar_movimientos" }] }];
    await page.getByLabel("Mensaje").fill("Gasté 85 en café");
    await page.getByLabel("Mensaje").press("Enter");
    await expect(page.getByText("Anotado: $85.00 en Café.")).toBeVisible();
    await expect(page.getByText("Registrado")).toBeVisible();
    expect((api.de("POST", "/v1/hablar")[1]?.cuerpo as Record<string, unknown>).conversacion_id).toBe("conv-7");
  });
});

test.describe("Chat sin perder ni duplicar mensajes", () => {
  const anotado = { respuesta: "Anotado: $85.00 en Café.", conversacion_id: "conv-3", acciones: [{ herramienta: "registrar_movimientos" }] };
  const enviar = async (page: import("@playwright/test").Page, texto: string) => {
    await page.getByLabel("Mensaje").fill(texto);
    await page.getByLabel("Mensaje").press("Enter");
  };
  const idsDeCliente = (api: ApiFalsa) => api.de("POST", "/v1/hablar").map((p) => (p.cuerpo as { client_id: string }).client_id);

  test("si se corta la conexión, pregunta a la Mac antes de reenviar", async ({ page }) => {
    const api = new ApiFalsa();
    api.fallasHablar = ["corte"];
    api.hablar = [200, anotado];
    await prepararSesion(page, api);
    await page.goto("/#chat");
    await enviar(page, "Gasté 85 en café");

    await expect(page.getByText("Anotado: $85.00 en Café.")).toBeVisible();
    await expect(page.getByText("Registrado")).toBeVisible();
    await expect(page.getByText("No se completó")).toHaveCount(0);
    const [id] = idsDeCliente(api);
    expect(idsDeCliente(api)).toHaveLength(1); // no se reenvió: la Mac ya lo tenía
    expect(api.de("GET", `/v1/entradas/${id}`).length).toBeGreaterThan(0);

    // La conversación sigue con el id que dio la entrada.
    await enviar(page, "¿y hoy?");
    await expect(page.getByText("Anotado: $85.00 en Café.")).toHaveCount(2);
    expect((api.de("POST", "/v1/hablar")[1]?.cuerpo as { conversacion_id?: string }).conversacion_id).toBe("conv-3");
  });

  test("si nunca llegó a la Mac, ofrece reintentar con el mismo client_id", async ({ page }) => {
    const api = new ApiFalsa();
    api.fallasHablar = ["perdido"];
    api.hablar = [200, anotado];
    await prepararSesion(page, api);
    await page.goto("/#chat");
    await enviar(page, "Gasté 85 en café");

    await expect(page.getByText("Este mensaje no llegó a tu Mac.")).toBeVisible();
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByText("Anotado: $85.00 en Café.")).toBeVisible();
    const ids = idsDeCliente(api);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  test("409 (se sigue procesando) espera la respuesta en vez de marcar error", async ({ page }) => {
    const api = new ApiFalsa();
    api.fallasHablar = ["procesando"];
    api.hablar = [200, anotado];
    await prepararSesion(page, api);
    await page.goto("/#chat");
    await enviar(page, "Gasté 85 en café");

    await expect(page.getByText("Anotado: $85.00 en Café.")).toBeVisible();
    await expect(page.getByText("todavía se está procesando")).toHaveCount(0);
    await expect(page.getByText("No se completó")).toHaveCount(0);
    expect(idsDeCliente(api)).toHaveLength(1);
  });

  test("503: Reintentar reenvía con el mismo client_id y no muestra el texto pensado para el Atajo", async ({ page }) => {
    const api = new ApiFalsa();
    api.fallasHablar = ["ia"];
    api.hablar = [200, anotado];
    await prepararSesion(page, api);
    await page.goto("/#chat");
    await enviar(page, "Gasté 85 en café");

    await expect(page.getByText("No pude procesarlo ahora. Inténtalo de nuevo en un momento.")).toBeVisible();
    await expect(page.getByText("queda guardado en tu iPhone")).toHaveCount(0);
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByText("Anotado: $85.00 en Café.")).toBeVisible();
    await expect(page.getByText("No se completó")).toHaveCount(0);
    const ids = idsDeCliente(api);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });
});

test.describe("Ajustes", () => {
  test("dispositivos, invitación y quitar un dispositivo", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#ajustes");
    await expect(page.getByText("Pedro Ramírez")).toBeVisible();
    await expect(page.getByText("Este dispositivo", { exact: true })).toBeVisible();
    await expect(page.getByText("MacBook Pro")).toBeVisible();

    await page.getByRole("button", { name: /Agregar otro dispositivo/ }).click();
    const hoja = page.getByRole("dialog");
    await expect(hoja.locator("[data-codigo]")).toHaveText("K7M2QX");
    await expect(hoja.getByText("?codigo=K7M2QX")).toBeVisible();
    await expect(hoja.getByText(/Vence/)).toBeVisible();
    expect(api.de("POST", "/v1/invitaciones")[0]?.cuerpo).toEqual({ para: "dispositivo" });
    await hoja.getByRole("button", { name: "Listo" }).click();

    await page.getByRole("button", { name: /Invitar a alguien/ }).click();
    await expect(page.getByRole("dialog").getByText("Invitar a alguien")).toBeVisible();
    expect(api.de("POST", "/v1/invitaciones")[1]?.cuerpo).toEqual({ para: "usuario" });
    await page.getByRole("dialog").getByRole("button", { name: "Listo" }).click();

    await page.getByRole("button", { name: "Quitar MacBook Pro" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Quitar" }).click();
    await expect(page.getByText("MacBook Pro")).toHaveCount(0);
    expect(api.de("DELETE", "/v1/dispositivos/dis-3")).toHaveLength(1);
  });

  test("instalar el Atajo pide la URL con el origen, lo descarga y muestra los pasos", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#ajustes");
    const descarga = page.waitForEvent("download");
    await page.getByRole("button", { name: /Instalar el Atajo/ }).click();
    const archivo = await descarga;
    expect(archivo.url()).toMatch(/^http:\/\/127\.0\.0\.1:4173\/atajo\/[\w-]+\.shortcut$/);
    expect(archivo.suggestedFilename()).toBe("Finanzas.shortcut");
    expect(api.de("POST", "/v1/atajo")[0]?.cuerpo).toEqual({ servidor: "http://127.0.0.1:4173" });

    const hoja = page.getByRole("dialog", { name: "Instalar el Atajo" });
    await expect(hoja.getByRole("listitem")).toHaveText(PASOS_DESCARGA);
    const otra = page.waitForEvent("download");
    await hoja.getByRole("button", { name: "¿No se descargó? Toca aquí" }).click();
    expect((await otra).url()).toBe(archivo.url());
    await hoja.getByRole("button", { name: "Listo" }).click();
    await expect(hoja).toHaveCount(0);
  });

  test("cerrar sesión borra el token", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#ajustes");
    await page.getByRole("button", { name: /Cerrar sesión en este dispositivo/ }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.getByRole("heading", { name: "Entra a Finanzas" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("fa_token"))).toBeNull();
  });
});

test.describe("Sin conexión", () => {
  test("muestra el aviso, los últimos datos y desactiva cambios", async ({ page, context }) => {
    await prepararSesion(page);
    await page.goto("/#inicio");
    await expect(page.getByRole("region", { name: "Gastado" })).toContainText("$16,754.70");
    await context.setOffline(true);
    await expect(page.getByText("Sin conexión")).toBeVisible();
    await expect(page.getByRole("button", { name: "Agregar movimiento" })).toBeDisabled();
    await expect(page.getByRole("region", { name: "Gastado" })).toContainText("$16,754.70");
    await context.setOffline(false);
  });

  test("al recargar sin la Mac, la caché guardada muestra el tablero", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#inicio");
    await expect(page.getByRole("region", { name: "Gastado" })).toContainText("$16,754.70");
    // Espera a que se persista la caché (se guarda con un pequeño retraso).
    await expect.poll(() => page.evaluate(() => localStorage.getItem("fa_cache")?.includes("16754") ?? false)).toBe(true);
    // La Mac deja de responder: la app abre con lo último guardado.
    await page.unroute(/\/v1\//);
    await page.route(/\/v1\//, (route) => route.abort("internetdisconnected"));
    await page.reload();
    await expect(page.getByRole("region", { name: "Gastado" })).toContainText("$16,754.70");
  });
});

test.describe("Pantalla angosta", () => {
  test.use({ viewport: { width: 375, height: 667 } });
  test("ninguna pantalla se desplaza hacia los lados a 375 px", async ({ page }) => {
    await prepararSesion(page);
    const sinDesborde = async () =>
      expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

    await page.goto("/#inicio");
    await expect(page.getByRole("region", { name: "Gastado" })).toContainText("$16,754.70");
    await sinDesborde();

    await page.goto("/#movimientos");
    await expect(page.getByText(/\d+ movimientos/).first()).toBeVisible();
    await sinDesborde();

    await page.goto("/#chat");
    await expect(page.locator("#mensaje")).toBeVisible();
    await sinDesborde();

    await page.goto("/#ajustes");
    await expect(page.getByText("Dispositivos")).toBeVisible();
    await sinDesborde();
  });
});

test.describe("Instalar el Atajo con enlace", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-06T12:30:00-06:00"));
  });

  test("revisa el código, saluda, canjea y descarga el Atajo", async ({ page }) => {
    const api = new ApiFalsa();
    await api.instalar(page);
    await page.goto("/instalar?codigo=dev456");

    await expect(page.getByRole("heading", { name: "Tu Atajo Finanzas" })).toBeVisible();
    await expect(page.getByText("Hola, Pedro. Así vas a hablar con tus finanzas.")).toBeVisible();
    await expect(page.getByText("Ábrelo y toca «Agregar atajo».")).toBeVisible();
    await expect(page.locator("#codigo")).toHaveCount(0); // el código ya vino en el enlace
    expect(api.de("GET", "/v1/invitaciones/DEV456")).toHaveLength(1);

    const descarga = page.waitForEvent("download");
    await page.getByRole("button", { name: "Instalar el Atajo" }).click();
    const archivo = await descarga;
    expect(archivo.url()).toMatch(/^http:\/\/127\.0\.0\.1:4173\/atajo\/[\w-]+\.shortcut$/);
    const canje = api.de("POST", "/v1/atajo/canjear");
    expect(canje).toHaveLength(1);
    expect(canje[0]?.cuerpo).toEqual({ codigo: "DEV456", servidor: "http://127.0.0.1:4173" });
    expect(canje[0]?.autorizacion).toBeUndefined();

    // Éxito: los 3 pasos que sí funcionan en iOS.
    await expect(page.getByText("Ya casi está. Sigue estos 3 pasos:")).toBeVisible();
    await expect(page.getByRole("list", { name: "Pasos para terminar" }).getByRole("listitem")).toHaveText(PASOS_DESCARGA);
    await expect(page.getByRole("link", { name: "Abrir la app Finanzas" })).toHaveAttribute("href", "/");

    // "¿No se descargó?" vuelve a abrir el mismo archivo sin canjear otra vez.
    const otra = page.waitForEvent("download");
    await page.getByRole("button", { name: "¿No se descargó? Toca aquí" }).click();
    expect((await otra).url()).toBe(archivo.url());
    expect(api.de("POST", "/v1/atajo/canjear")).toHaveLength(1);
    expect(await page.evaluate(() => localStorage.getItem("fa_token"))).toBeNull();
  });

  test("sin código en el enlace pide escribirlo", async ({ page }) => {
    await new ApiFalsa().instalar(page);
    await page.goto("/instalar");
    await expect(page.getByRole("button", { name: "Instalar el Atajo" })).toBeDisabled();
    await page.locator("#codigo").fill("dev456");
    await expect(page.getByText("Código válido")).toBeVisible();
    await expect(page.getByText("Hola, Pedro.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Instalar el Atajo" })).toBeEnabled();
  });

  test("un código de cuenta nueva (400) manda a abrirlo en la app", async ({ page }) => {
    const api = new ApiFalsa();
    await api.instalar(page);
    await page.goto("/instalar?codigo=ABC123");
    const aviso = page.getByText("Este código es para crear una cuenta. Ábrelo en la app.");
    await expect(aviso).toBeVisible();
    await expect(page.getByRole("button", { name: "Instalar el Atajo" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Abrir en la app" })).toHaveAttribute("href", "/?codigo=ABC123");
    expect(api.de("POST", "/v1/atajo/canjear")).toHaveLength(0);

    // Si la revisión no lo detectara, el 400 del canje dice lo mismo.
    await page.route(/\/v1\/invitaciones\/ABC123$/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ para: "dispositivo", nombre: "Pedro" }) }),
    );
    await page.reload();
    await page.getByRole("button", { name: "Instalar el Atajo" }).click();
    await expect(aviso).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir en la app" })).toBeVisible();
    expect(api.de("POST", "/v1/atajo/canjear")).toHaveLength(1);
  });

  test("un código vencido (410), al abrirlo o al instalar", async ({ page }) => {
    const api = new ApiFalsa();
    await api.instalar(page);
    await page.goto("/instalar?codigo=VIEJO1");
    const vencido = page.getByText("Ese código ya se usó o venció. Pide uno nuevo.");
    await expect(vencido).toBeVisible();
    await expect(page.getByRole("button", { name: "Instalar el Atajo" })).toBeDisabled();

    // Aparecen las casillas para escribir otro.
    await page.locator("#codigo").fill("DEV456");
    await expect(page.getByText("Hola, Pedro.")).toBeVisible();

    // Otro dispositivo lo canjeó mientras tanto: el canje responde 410.
    api.usados.add("DEV456");
    await page.getByRole("button", { name: "Instalar el Atajo" }).click();
    await expect(vencido).toBeVisible();
    await expect(page.getByRole("button", { name: "Instalar el Atajo" })).toBeDisabled();
  });

  test("si la Mac no puede firmar (501) ofrece reintentar; con sesión no toca el token", async ({ page }) => {
    const api = new ApiFalsa();
    api.fallasFirma = 1;
    await prepararSesion(page, api);
    await page.goto("/instalar?codigo=DEV456");
    await expect(page.getByText("Hola, Pedro.")).toBeVisible();

    await page.getByRole("button", { name: "Instalar el Atajo" }).click();
    await expect(page.getByText("Tu Mac no pudo firmar el Atajo. Tu código sigue sirviendo")).toBeVisible();
    const descarga = page.waitForEvent("download");
    await page.getByRole("button", { name: "Reintentar" }).click();
    await descarga;
    await expect(page.getByText("Ya casi está")).toBeVisible();

    const canjes = api.de("POST", "/v1/atajo/canjear");
    expect(canjes).toHaveLength(2);
    expect(canjes.map((c) => c.autorizacion)).toEqual([undefined, undefined]);
    expect(await page.evaluate(() => localStorage.getItem("fa_token"))).toBe(TOKEN);
    expect(api.de("GET", "/v1/yo")).toHaveLength(0); // no abrió la app
  });
});

test.describe("Service worker", () => {
  test("no tiene ninguna ruta para /atajo/ (Safari guardaría la descarga como .html)", () => {
    const sw = readFileSync(`${test.info().config.rootDir}/../dist/sw.js`, "utf8");
    const lista = /denylist:\s*\[([^\]]*)\]/;
    // /atajo/ solo aparece en las navegaciones que no se responden con index.html.
    expect(sw.match(lista)?.[1]).toContain("atajo");
    expect(sw.replace(lista, "")).not.toContain("atajo");
    expect(sw).toContain('startsWith("/v1/")');
  });

  test.describe("activo", () => {
    test.use({ serviceWorkers: "allow" });
    test("deja que el navegador descargue el Atajo por su cuenta", async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-10-06T12:30:00-06:00"));
      await new ApiFalsa().instalar(page);
      await page.goto("/");
      // Sin clientsClaim, la página queda controlada desde la siguiente carga.
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await page.reload();
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
      const delServiceWorker = new Map<string, boolean>();
      page.on("response", (r) => delServiceWorker.set(new URL(r.url()).pathname, r.fromServiceWorker()));
      await page.evaluate(async () => {
        await fetch("/favicon.svg");
        await fetch("/atajo/prueba.shortcut");
      });
      expect(delServiceWorker.get("/favicon.svg")).toBe(true); // control: sí sale de la caché
      expect(delServiceWorker.get("/atajo/prueba.shortcut")).toBe(false);
    });
  });
});

test.describe("Ritmo y Destacados", () => {
  test("pasar el dedo por la gráfica muestra lo gastado a ese día", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/");
    const gastado = page.getByRole("region", { name: "Gastado" });
    await expect(gastado).toContainText("$16,754.70");
    const ritmo = page.getByRole("img", { name: /Ritmo de gasto/ });
    const caja = await ritmo.boundingBox();
    if (!caja) throw new Error("sin caja");
    // Día 1 de 31: el principio de la gráfica. El 1 de octubre se gastaron $12,500 (renta).
    await page.mouse.move(caja.x + 2, caja.y + caja.height / 2);
    await expect(gastado).toContainText("Gastado al 1 de octubre");
    await expect(gastado).toContainText("$12,500.00");
    await expect(gastado).toContainText("$12,500.00 al 1 de septiembre");
    // Más allá de hoy no hay datos: se queda en el 6.
    await page.mouse.move(caja.x + caja.width - 2, caja.y + caja.height / 2);
    await expect(gastado).toContainText("Gastado al 6 de octubre");
    await page.mouse.move(1, 1);
    await expect(gastado).toContainText("Gastado en octubre");
    await expect(gastado).toContainText("20% más que al 6 de septiembre");
  });

  test("si no llega el gasto por día, la tarjeta queda sin gráfica", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.route(/\/v1\/movimientos\?.*tipo=gasto.*limite=500/, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"falla"}' }),
    );
    await page.goto("/");
    const gastado = page.getByRole("region", { name: "Gastado" });
    await expect(gastado).toContainText("$16,754.70");
    // Tras los reintentos se rinde: sin esqueleto eterno ni leyenda de días.
    await expect(gastado).not.toContainText("1 oct", { timeout: 10_000 });
    await expect(gastado.locator(".animate-pulse")).toHaveCount(0);
    await expect(page.getByRole("img", { name: /Ritmo de gasto/ })).toHaveCount(0);
    expect(api.de("GET", "/v1/tablero").length).toBeGreaterThan(0);
  });

  test("los destacados llevan a Movimientos o le preguntan al chat", async ({ page }) => {
    const api = new ApiFalsa();
    api.hablar = [200, { respuesta: "Guarda $500 por semana.", conversacion_id: "conv-9", acciones: [] }];
    await prepararSesion(page, api);
    await page.goto("/");
    const destacados = page.getByRole("region", { name: "Destacados" });
    await expect(destacados).toContainText("cerrarás octubre en unos $27,100");
    await expect(destacados).toContainText("3 compras en Oxxo este mes: $136");
    await expect(destacados).toContainText("Te queda el 11% de lo que te entró en octubre");

    await destacados.getByRole("button", { name: "Ver compras" }).click();
    await expect(page).toHaveURL(/#movimientos\?.*q=Oxxo/);
    await expect(page.getByText("3 movimientos")).toBeVisible();

    await page.goBack();
    await page.getByRole("region", { name: "Destacados" }).getByRole("button", { name: "Pedir un plan" }).click();
    await expect(page).toHaveURL(/#chat$/);
    await expect(page.getByText("Guarda $500 por semana.")).toBeVisible();
    const hablar = api.de("POST", "/v1/hablar")[0]?.cuerpo as Record<string, unknown>;
    expect(hablar.texto).toMatch(/plan sencillo para ahorrar/);
  });

  test("el + vive junto a las pestañas y se esconde en Chat", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/");
    const agregar = page.getByRole("button", { name: "Agregar movimiento" });
    await expect(agregar).toBeVisible();
    await page.getByRole("link", { name: "Chat" }).click();
    await expect(page.getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");
    await expect(agregar).toBeHidden();
  });
});
