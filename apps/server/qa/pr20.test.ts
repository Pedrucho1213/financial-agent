// QA del PR #20: entrar con usuario y código personal. Correr desde apps/server: bun test qa/pr20.test.ts
import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo, crearUsuario, ponerCodigo } from "../src/auth";
import { preparar, texto } from "../test/ayuda";

const BIEN = "mi gato come tacos";
async function montar() {
  const { db, usuario } = preparar({ ahora: new Date() });
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: async () => texto("x") }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN", firmarAtajo: async (xml: string) => new TextEncoder().encode(xml) } as any);
  await ponerCodigo(db, usuario.id, BIEN);
  return { db, usuario, token, app };
}
const entrar = (app: any, usuario: string, codigo: string, ip = "198.51.100.7") =>
  app.request("https://finanzas.example/v1/entrar", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ usuario, codigo, dispositivo: "iPad" }) });

test("usuario inexistente y código equivocado responden igual (estado, cuerpo y tiempo)", async () => {
  const { app } = await montar();
  await entrar(app, "pedro", "calentar el relleno");
  const medir = async (u: string, c: string, ip: string) => { const t = performance.now(); const r = await entrar(app, u, c, ip); return { s: r.status, b: await r.text(), ms: performance.now() - t }; };
  const malos: number[] = [], nadie: number[] = [];
  let a: any, b: any;
  for (let i = 0; i < 5; i++) {
    a = await medir("pedro", `codigo malo ${i}x`, `198.51.100.${i}`);
    b = await medir("noexiste", `codigo malo ${i}x`, `198.51.101.${i}`);
    malos.push(a.ms); nadie.push(b.ms);
  }
  const med = (x: number[]) => x.sort((p, q) => p - q)[2]!.toFixed(1);
  console.log("pedro/malo:", a.s, a.b, med(malos), "ms | noexiste:", b.s, b.b, med(nadie), "ms");
  expect(a.s).toBe(b.s);
  expect(a.b).toBe(b.b);
});

test("el código bien entra; variantes de mayúsculas y espacios también", async () => {
  const { app } = await montar();
  for (const [u, c] of [["pedro", BIEN], [" PEDRO ", "Mi gato  come tacos "], ["Pédro", BIEN]] as const) {
    const r = await entrar(app, u, c);
    console.log(JSON.stringify(u), JSON.stringify(c), "→", r.status);
    expect(r.status).toBe(201);
  }
});

test("límite por usuario desde muchas IPs: ¿un extraño deja fuera al dueño?", async () => {
  const { app } = await montar();
  for (let i = 0; i < 10; i++) await entrar(app, "pedro", `adivina ${i} zz`, `203.0.113.${i}`);
  const r = await entrar(app, "pedro", BIEN, "198.51.100.200");
  console.log("dueño con el código correcto tras 10 fallos de extraños:", r.status, await r.text());
  expect(r.status).toBe(201);
});

test("desde 30 IPs: el tope por usuario (100 en 15 min desde 9a84229) frena", async () => {
  const { app } = await montar();
  const estados: number[] = [];
  for (let i = 0; i < 30; i++) estados.push((await entrar(app, "pedro", `adivina ${i} zz`, `203.0.113.${i}`)).status);
  console.log("estados:", estados.join(","));
  expect(estados.filter((s) => s === 401).length).toBeLessThanOrEqual(100);
}, 30000); // 30 verificaciones argon2 seguidas tardan ~5 s en el contenedor

test("un token robado cambia el código sin saber el anterior y entra desde otro lado", async () => {
  const { app, token } = await montar();
  const r = await app.request("https://finanzas.example/v1/yo/codigo", { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ codigo: "codigo del ladron 9" }) });
  const e = await entrar(app, "pedro", "codigo del ladron 9", "203.0.113.77");
  console.log("PUT /yo/codigo sin el código actual:", r.status, "→ entrar con el nuevo:", e.status);
});

test("cambiar el usuario a uno ocupado, raro o con mayúsculas", async () => {
  const { db, app, token } = await montar();
  crearUsuario(db, "Ana");
  const patch = (body: unknown) => app.request("https://finanzas.example/v1/yo", { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  for (const body of [{ usuario: "ana" }, { usuario: "ANA" }, { usuario: "Ána" }, { usuario: "ab" }, { usuario: "__x" }, { usuario: "pedro.p" }, { nombre: "   " }, { nombre: "x".repeat(41) }, { nombre: "Pedrito <script>" }, {}]) {
    const r = await patch(body);
    console.log(JSON.stringify(body), "→", r.status, (await r.text()).slice(0, 120));
  }
});

test("códigos obvios", async () => {
  const { app, token } = await montar();
  for (const codigo of ["12345678", "aaaaaaaa", "abcabcab", "contraseña1", "pedro123", "pedropedro", "11111112", "qwertyuiop", "        a", "1234 5678"]) {
    const r = await app.request("https://finanzas.example/v1/yo/codigo", { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-forwarded-for": "198.51.100.3" }, body: JSON.stringify({ codigo }) });
    console.log(JSON.stringify(codigo), "→", r.status);
  }
});

test("rutas nuevas sin token", async () => {
  const { app } = await montar();
  for (const [m, ruta] of [["PATCH", "/v1/yo"], ["PUT", "/v1/yo/codigo"], ["DELETE", "/v1/yo/codigo"]] as const) {
    const r = await app.request(ruta, { method: m, headers: { "content-type": "application/json" }, body: "{}" });
    console.log(m, ruta, r.status);
    expect(r.status).toBe(401);
  }
});

test("GET /v1/yo no filtra el hash", async () => {
  const { app, token } = await montar();
  const r = await app.request("/v1/yo", { headers: { authorization: `Bearer ${token}` } });
  const t = await r.text();
  console.log(t.slice(0, 200));
  expect(t).not.toContain("argon2");
});

test("atajo/entrar con servidor ajeno y sin firma", async () => {
  const { app } = await montar();
  const r = await app.request("https://finanzas.example/v1/atajo/entrar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ usuario: "pedro", codigo: BIEN, servidor: "https://atacante.example" }) });
  console.log("servidor ajeno:", r.status);
  expect(r.status).toBe(400);
});
