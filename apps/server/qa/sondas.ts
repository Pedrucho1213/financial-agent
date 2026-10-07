import { montosDelTexto, montoConPalabras } from "../src/lib/numeros";
import { resolverFecha, fechasDelTexto, resolverPeriodo } from "../src/lib/fechas";
import { esPregunta, monedaDelTexto, tipoDelTexto } from "../src/lib/texto";
import { z } from "zod";
const hoy = "2026-10-06"; // martes
const p = (...a: unknown[]) => console.log(...a.map((x) => JSON.stringify(x)));
console.log("== montos");
for (const t of ["un millón doscientos mil", "un millón quinientos mil pesos", "dos millones", "ciento veinte mil", "veintiún mil", "mil doscientos cincuenta", "gasté 1,250.50 en el súper", "me costó 2 mil 500", "tres cincuenta", "gasté 85.5", "1.5k en ropa", "quinientos cincuenta y cinco", "dos mil trescientos cuarenta y cinco", "150 pesos con 50 centavos", "gasté $85", "gasté 1.200 pesos", "noventa y nueve", "compré una pizza de doscientos", "mil", "me cobraron 35 de comisión"])
  p(t, montosDelTexto(t), montoConPalabras(t));
console.log("== fechas resolverFecha");
for (const t of ["hace un mes", "semana pasada", "la semana pasada", "el 30", "el día 30", "15 de octubre", "el 6 de octubre", "martes", "el martes pasado", "hace 15 días", "anteayer", "2026-10-06T10:00:00", "5/10", "31/02", "primero de octubre", "el 1 de este mes", "quincena", "el lunes 5 de octubre", "mañana", "ayer en la noche"])
  p(t, resolverFecha(t, hoy));
console.log("== fechasDelTexto");
for (const t of ["el lunes gasté 80 en café y el martes 120 en el súper", "ayer en la noche gasté 200", "hace un mes pagué 500", "el día 3 de octubre pagué la luz", "gasté 15 de septiembre"]) p(t, fechasDelTexto(t, hoy));
console.log("== periodos");
for (const t of ["este_mes", "mes_pasado", "septiembre", "2026-09", "ultimos_7_dias", "este_anio", "hoy", "todo", "ultima_semana", "este año", "2026-09-01..2026-09-30", "quincena", "esta_quincena", "ayer", "semana_pasada"]) p(t, resolverPeriodo(t, hoy));
console.log("== esPregunta");
for (const t of ["cuánto llevo gastado", "Oye, cuánto llevo gastado este mes", "Quiero saber cuánto gasté en Uber", "y en Uber", "Cuéntame cómo voy", "Ver mis gastos", "Necesito saber mis suscripciones", "Me puedes decir cuánto gasté", "En qué gasto más", "Cuál fue mi gasto más grande", "Gasté 85 en café", "Tengo que pagar la renta el 5", "Qué onda, gasté 200 en tacos", "Hay que pagar 300 de luz", "Puedo gastar 500 hoy", "Voy bien este mes", "Debo algo"]) p(t, esPregunta(t));
console.log("== moneda/tipo");
for (const t of ["compré 2 libras de carne en 180", "pagué 20 dólares de Spotify", "pagué 15 dólares o sea 270 pesos", "gasté 100 varos", "Me llegó la quincena", "Me regalaron 500", "Le pagué 300 a Juan que me prestó", "Juan me pagó los 500 que le presté", "Me devolvieron 300 de Amazon", "Deposité 1000 a mi ahorro", "Me transfirió mi mamá 2000", "Cobré 5000 de un freelance", "Vendí mi bici en 2000", "Saqué 500 del cajero"]) p(t, monedaDelTexto(t), tipoDelTexto(t));
console.log("== capturado_en (zod)");
const iso = z.iso.datetime({ offset: true });
for (const t of ["2026-10-06T17:08:45-06:00", "2026-10-06T17:08:45-0600", "2026-10-06T17:08:45Z", "2026-10-06T17:08:45.123-06:00", "2026-10-06T17:08:45", "2026-10-06 17:08:45 -0600", "2026-10-06T17:08-06:00"]) p(t, iso.safeParse(t).success);
console.log("== lat coerce");
for (const t of ["19.4326", "19,4326", " -99.13 "]) p(t, z.coerce.number().min(-90).max(90).safeParse(t).success);
