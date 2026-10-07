import { test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { preparar, texto } from "../test/ayuda";
test("traversal", async () => {
  const { db } = preparar();
  const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: async () => texto("x") }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN", carpetaWeb: "/tmp/claude-0/webdist" } as any);
  for (const r of ["/../secreto.txt", "/%2e%2e/secreto.txt", "/..%2fsecreto.txt", "/%2e%2e%2fsecreto.txt", "/assets/..%2f..%2fsecreto.txt", "/....//secreto.txt", "/%252e%252e/secreto.txt", "/index.html", "/.env", "/x.map"]) {
    const res = await app.fetch(new Request("http://h" + r));
    const t = await res.text();
    console.log(r, res.status, t.includes("secreto") ? "¡FILTRA!" : t.slice(0, 20).replace(/\n/g, ""));
  }
});
