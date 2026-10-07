import { expect, test } from "@playwright/test";
import { ApiFalsa, HOY, prepararSesion, TOKEN } from "./api-falsa";

test.describe("Entrar", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-06T12:30:00-06:00"));
  });

  test("registro con código de usuario nuevo desde ?codigo=", async ({ page }) => {
    const api = new ApiFalsa();
    await api.instalar(page);
    await page.goto("/?codigo=abc123");

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
    await page.getByRole("button", { name: "¿Cuánto gasté esta semana?" }).click();

    await expect(page.getByText("Esta semana llevas $1,234.50")).toBeVisible();
    await expect(page.getByText("Revisó tus gastos")).toBeVisible();

    const hablar = api.de("POST", "/v1/hablar")[0]?.cuerpo as Record<string, unknown>;
    expect(hablar.texto).toBe("¿Cuánto gasté esta semana?");
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

  test("instalar el Atajo pide la URL con el origen y navega a ella", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.route(/\/v1\/atajo$/, (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ url: "/atajo/abc123.shortcut", expiraEn: "2026-10-06T18:40:00.000Z" }),
      }),
    );
    let pedido: unknown = null;
    page.on("request", (r) => {
      if (r.url().endsWith("/v1/atajo")) pedido = r.postDataJSON();
    });
    await page.route(/\/atajo\/abc123\.shortcut$/, (route) =>
      route.fulfill({ status: 200, contentType: "text/plain", body: "atajo" }),
    );
    await page.goto("/#ajustes");
    await page.getByRole("button", { name: /Instalar el Atajo/ }).click();
    await page.waitForURL(/\/atajo\/abc123\.shortcut$/);
    expect(pedido).toEqual({ servidor: "http://127.0.0.1:4173" });
    void api;
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
