import type { LanguageModelUsage } from "ai";
import { and, eq, gte, inArray, isNotNull, like, ne, sql, sum } from "drizzle-orm";
import { esDueno, idDueno } from "../auth";
import type { Db } from "../db/client";
import { configuracion, entradas, usuarios, usoIa } from "../db/schema";

/**
 * Cuánto se usa la IA y cuánto cuesta, por cuenta. Cada llamada al modelo queda en `uso_ia` con sus tokens y su
 * costo estimado; con eso se cuentan las consultas del día (el tope que ve la persona) y el gasto del mes.
 */

/**
 * Cada 500 caracteres de lo dicho o escrito cuentan como una consulta (unos 30 segundos hablando; un gasto ocupa de 30 a
 * 100). El texto se procesa completo en una sola llamada, para no partir una frase a la mitad; solo se cobra por bloques.
 * Más de 3 bloques no se procesa: suele ser un texto pegado o alguien que se quedó hablando (2026-10-14).
 */
export const CARACTERES_POR_CONSULTA = 500;
export const MAX_DICTADO = 3 * CARACTERES_POR_CONSULTA;
export const RESPUESTA_MUY_LARGO = "Eso fue muy largo. Dímelo en partes más cortas, de unos 30 segundos.";

/** Cuántas consultas cuesta un texto: una por cada 500 caracteres, mínimo una. */
export const consultasDe = (texto: string) => Math.max(1, Math.ceil(texto.trim().length / CARACTERES_POR_CONSULTA));

/**
 * Los topes que cuidan la factura de Claude; 0 apaga cada uno. Las consultas son lo que la persona ve; los topes en USD
 * acotan lo que de verdad cuesta, aunque alguien encuentre cómo hacer cada consulta más cara. La cuenta dueña solo tiene
 * el suyo en USD por día, por si le roban un token (2026-10-14).
 */
export type LimitesIa = {
  /** Consultas al modelo por día y por cuenta (IA_CONSULTAS_DIA). */
  consultasDia: number;
  /** USD al mes en el modelo difícil (Sonnet) por cuenta; al pasarlo, todo va al principal (IA_TOPE_DIFICIL_USD). */
  topeDificilUsd: number;
  /** USD por día y por cuenta, contando el precalentado (IA_TOPE_DIA_USD). */
  topeDiaUsd?: number;
  /** USD por día de la cuenta dueña (IA_TOPE_DIA_DUENO_USD). */
  topeDiaDuenoUsd?: number;
  /**
   * El límite de gasto de la consola de Anthropic (IA_PRESUPUESTO_USD). Al gastar el 90% del mes, o el 20% en un solo día,
   * las demás cuentas se quedan sin IA para que la dueña no se quede sin Claude.
   */
  presupuestoMesUsd?: number;
};

/** Qué parte del presupuesto del mes pausa la IA de las demás cuentas, en el mes y en un solo día. */
export const PAUSA_MES = 0.9;
export const PAUSA_DIA = 0.2;

// USD por millón de tokens (octubre de 2026): https://platform.claude.com/docs/en/about-claude/pricing
// Un modelo de Claude que no está aquí se cobra como Sonnet, para no quedarse corto; los de la Mac no cuestan.
const PRECIOS = [
  { familia: "haiku", entrada: 0.1, escritura: 0.125, lectura: 0.01, salida: 0.5 },
  { familia: "sonnet", entrada: 2, escritura: 2.5, lectura: 0.1, salida: 10 },
  { familia: "opus", entrada: 4, escritura: 5, lectura: 0.4, salida: 20 },
] as const;

const precioDe = (modelo: string) =>
  modelo.startsWith("claude-") ? (PRECIOS.find((p) => modelo.includes(p.familia)) ?? PRECIOS[1]) : undefined;

/** Tokens de una llamada, separados como los cobra Anthropic. */
function tokensDe(usage: LanguageModelUsage | undefined) {
  const lectura = usage?.inputTokenDetails?.cacheReadTokens ?? 0;
  const escritura = usage?.inputTokenDetails?.cacheWriteTokens ?? 0;
  const entrada = usage?.inputTokenDetails?.noCacheTokens ?? Math.max(0, (usage?.inputTokens ?? 0) - lectura - escritura);
  return { entrada, lectura, escritura, salida: usage?.outputTokens ?? 0 };
}

/** Costo en millonésimas de dólar: tokens × USD por millón. */
export function costoMicroUsd(modelo: string, usage: LanguageModelUsage | undefined): number {
  const precio = precioDe(modelo);
  if (!precio) return 0;
  const t = tokensDe(usage);
  return Math.round(t.entrada * precio.entrada + t.escritura * precio.escritura + t.lectura * precio.lectura + t.salida * precio.salida);
}

export type Paso = { response?: { modelId?: string }; usage?: LanguageModelUsage };

/** Guarda lo que costó cada paso de una llamada al modelo. Sin `entradaId` (el precalentado) no cuenta como consulta. */
export function anotarUso(db: Db, datos: { usuarioId: string; entradaId?: string; dia: string; pasos: Paso[] }) {
  for (const paso of datos.pasos) {
    const modelo = paso.response?.modelId || "desconocido";
    const t = tokensDe(paso.usage);
    db.insert(usoIa)
      .values({
        usuarioId: datos.usuarioId,
        entradaId: datos.entradaId,
        dia: datos.dia,
        modelo,
        tokensEntrada: t.entrada,
        tokensCacheLectura: t.lectura,
        tokensCacheEscritura: t.escritura,
        tokensSalida: t.salida,
        costoMicroUsd: costoMicroUsd(modelo, paso.usage),
      })
      .run();
  }
}

/**
 * Consultas de la cuenta en el día, sin contar `salvo`: cada dictado o mensaje que llegó al modelo, una vez aunque se
 * reintente, pesado por su largo (`consultasDe`). El texto se guarda ya sin espacios en las orillas.
 */
export function consultasDelDia(db: Db, usuarioId: string, dia: string, salvo?: string): number {
  const llegaron = db
    .selectDistinct({ id: usoIa.entradaId })
    .from(usoIa)
    .where(and(eq(usoIa.usuarioId, usuarioId), eq(usoIa.dia, dia), isNotNull(usoIa.entradaId)));
  const fila = db
    .select({ n: sql<number | null>`sum(max(1, (length(${entradas.texto}) + ${CARACTERES_POR_CONSULTA - 1}) / ${CARACTERES_POR_CONSULTA}))` })
    .from(entradas)
    .where(and(eq(entradas.usuarioId, usuarioId), inArray(entradas.id, llegaron), salvo ? ne(entradas.id, salvo) : undefined))
    .get();
  return Number(fila?.n ?? 0);
}

/** Lo gastado en el mes de `dia`, en USD: de una cuenta o de todas, y solo de los modelos de una familia si se pide. */
export function costoDelMes(db: Db, dia: string, filtro: { usuarioId?: string; familia?: string } = {}): number {
  const fila = db
    .select({ micro: sum(usoIa.costoMicroUsd) })
    .from(usoIa)
    .where(
      and(
        gte(usoIa.dia, `${dia.slice(0, 7)}-01`),
        filtro.usuarioId ? eq(usoIa.usuarioId, filtro.usuarioId) : undefined,
        filtro.familia ? like(usoIa.modelo, `%${filtro.familia}%`) : undefined,
      ),
    )
    .get();
  return Number(fila?.micro ?? 0) / 1e6;
}

/** Lo gastado en `dia`, en USD: de una cuenta o de todas. */
export function costoDelDia(db: Db, dia: string, usuarioId?: string): number {
  const fila = db
    .select({ micro: sum(usoIa.costoMicroUsd) })
    .from(usoIa)
    .where(and(eq(usoIa.dia, dia), usuarioId ? eq(usoIa.usuarioId, usuarioId) : undefined))
    .get();
  return Number(fila?.micro ?? 0) / 1e6;
}

/**
 * Por qué una cuenta ya no puede usar la IA como siempre: sus consultas (entonces sigue en modo básico), su tope en USD
 * del día o la pausa de toda la app (entonces se queda sin IA hasta mañana o el próximo mes).
 */
export type Bloqueo = "consultas" | "dia" | "pausa-dia" | "pausa-mes";

/**
 * Si la cuenta ya no puede usar la IA hoy, y por qué. Mientras le quede al menos una consulta, el dictado se procesa
 * aunque cueste más de lo que queda (uno largo al final del día): se pasa del tope como mucho por ese dictado, 2
 * consultas, y se le avisa. Los topes en USD se revisan antes de cada llamada: se pasan como mucho por esa llamada. Un
 * dictado que se reintenta no se cuenta dos veces (`entradaId`).
 */
export function bloqueoIa(db: Db, usuarioId: string, dia: string, limites: LimitesIa | undefined, entradaId?: string): Bloqueo | undefined {
  if (!limites) return undefined;
  if (esDueno(db, usuarioId)) {
    return limites.topeDiaDuenoUsd && costoDelDia(db, dia, usuarioId) >= limites.topeDiaDuenoUsd ? "dia" : undefined;
  }
  const presupuesto = limites.presupuestoMesUsd ?? 0;
  if (presupuesto > 0 && costoDelMes(db, dia) >= presupuesto * PAUSA_MES) return "pausa-mes";
  if (presupuesto > 0 && costoDelDia(db, dia) >= presupuesto * PAUSA_DIA) return "pausa-dia";
  if (limites.topeDiaUsd && costoDelDia(db, dia, usuarioId) >= limites.topeDiaUsd) return "dia";
  if (limites.consultasDia > 0 && consultasDelDia(db, usuarioId, dia, entradaId) >= limites.consultasDia) return "consultas";
  return undefined;
}

export type UsoDeHoy = {
  consultas: number;
  /** null: sin tope (la cuenta dueña, o IA_CONSULTAS_DIA=0). */
  limite: number | null;
  quedan: number | null;
  /** Si hoy ya no tiene la IA de siempre (modo básico, o sin IA), qué decirle. */
  aviso?: string;
  /** Ya usó sus consultas y sigue con respuestas más cortas. */
  modoBasico?: boolean;
};

export function usoDeHoy(db: Db, usuarioId: string, dia: string, limites: LimitesIa | undefined): UsoDeHoy {
  const consultas = consultasDelDia(db, usuarioId, dia);
  const limite = limites && limites.consultasDia > 0 && !esDueno(db, usuarioId) ? limites.consultasDia : null;
  const bloqueo = bloqueoIa(db, usuarioId, dia, limites);
  const aviso = bloqueo === "consultas" ? EN_MODO_BASICO : bloqueo ? respuestaSinIa(bloqueo, limite ?? 0) : undefined;
  return { consultas, limite, quedan: limite === null ? null : aviso ? 0 : Math.max(0, limite - consultas), ...(aviso ? { aviso } : {}), ...(bloqueo === "consultas" ? { modoBasico: true } : {}) };
}

/** Si ya gastó su tope del mes en el modelo difícil: entonces todo lo contesta el principal. */
export function sinModeloDificil(db: Db, usuarioId: string, dia: string, limites: LimitesIa | undefined): boolean {
  if (!limites || limites.topeDificilUsd <= 0 || esDueno(db, usuarioId)) return false;
  return costoDelMes(db, dia, { usuarioId, familia: "sonnet" }) >= limites.topeDificilUsd;
}

/**
 * Modo básico: al acabarse las consultas del día no se queda sin IA; sigue con el modelo principal (nunca Sonnet) y
 * respuestas más cortas, hasta su tope en USD del día. Así nadie se queda sin IA por usarla mucho, y la factura sigue
 * acotada (2026-10-14).
 */
export const MAX_SALIDA_BASICO = 300;
export const AVISO_MODO_BASICO = "Ya usaste tus consultas de hoy, así que sigo en modo básico: respuestas más cortas hasta mañana.";
/** Lo que ven la app y Ajustes mientras está en modo básico. */
export const EN_MODO_BASICO = "Modo básico hasta mañana: ya usaste tus consultas de hoy y las respuestas son más cortas.";

/** true solo la primera vez que se pregunta por `clave` (queda anotada en `configuracion`). */
export function primeraVez(db: Db, clave: string): boolean {
  return !!db.insert(configuracion).values({ clave, valor: true }).onConflictDoNothing().returning({ clave: configuracion.clave }).get();
}

/** Lo que se le dice al llegar al tope del día. */
export const RESPUESTA_SIN_CONSULTAS = (limite: number) =>
  `Ya usaste tus ${limite} consultas de IA de hoy. Mañana se renuevan; mientras, puedes anotar a mano en la app.`;

/** Lo que se le dice cuando no puede usar la IA, según por qué. Nunca un error sin explicar. */
export function respuestaSinIa(bloqueo: Bloqueo, limite: number): string {
  switch (bloqueo) {
    case "consultas":
      return RESPUESTA_SIN_CONSULTAS(limite);
    case "dia":
      return "Por hoy ya usaste toda la IA de tu cuenta. Mañana se renueva; mientras, puedes anotar a mano en la app.";
    case "pausa-dia":
      return "La IA está en pausa por hoy porque se usó mucho en la app. Mañana vuelve; mientras, puedes anotar a mano en la app.";
    case "pausa-mes":
      return "La IA está en pausa hasta el próximo mes porque se usó mucho en la app. Mientras, puedes anotar a mano en la app.";
  }
}

/**
 * Lo que se agrega a la respuesta de un dictado que costó `costo` consultas: si contó más de una por lo largo, y cuántas
 * quedan cuando son 5 o menos. Sin tope (la cuenta dueña), nada.
 */
export function avisoDeConsultas(uso: UsoDeHoy, costo = 1): string | undefined {
  if (uso.quedan === null) return undefined;
  const largo = costo > 1 ? `Por lo largo, ese mensaje contó como ${costo} consultas.` : undefined;
  const quedan =
    uso.quedan === 0
      ? "Con esto usaste tus consultas de IA de hoy; desde ahora sigo en modo básico, con respuestas más cortas, hasta mañana."
      : uso.quedan > 5
        ? undefined
        : uso.quedan === 1
          ? "Te queda 1 consulta de IA por hoy."
          : `Te quedan ${uso.quedan} consultas de IA por hoy.`;
  return [largo, quedan].filter(Boolean).join(" ") || undefined;
}

const usd = (n: number) => `$${n.toFixed(2)} USD`;

export type AvisoDeGasto = { titulo: string; cuerpo: string; etiqueta: string };

/**
 * Lo que hay que avisarle al dueño después de una llamada al modelo: cuánto va del presupuesto del mes (50%, 80% y la
 * pausa del 90%), un día con gasto fuera de lo normal, y cada cuenta que llega a su tope en USD del día (la suya, por si
 * le robaron un token; las demás, por si alguien está abusando). Cada aviso sale una sola vez: queda anotado en
 * `configuracion`.
 */
export function avisosDeGasto(db: Db, dia: string, limites: LimitesIa | undefined): AvisoDeGasto[] {
  if (!limites) return [];
  const avisos: (AvisoDeGasto & { clave: string })[] = [];
  const presupuesto = limites.presupuestoMesUsd ?? 0;
  if (presupuesto > 0) {
    const mes = costoDelMes(db, dia);
    const umbral = [PAUSA_MES, 0.8, 0.5].find((u) => mes >= presupuesto * u);
    if (umbral) {
      avisos.push({
        clave: `${dia.slice(0, 7)}:mes:${umbral}`,
        titulo: umbral === PAUSA_MES ? "IA en pausa para las demás cuentas" : `Claude: ${Math.round(umbral * 100)}% del presupuesto`,
        cuerpo:
          `Este mes van ${usd(mes)} de ${usd(presupuesto)}.` +
          (umbral === PAUSA_MES ? " Las demás cuentas se quedan sin IA hasta el próximo mes; la tuya sigue." : ""),
        etiqueta: "gasto-ia-mes",
      });
    }
    const hoy = costoDelDia(db, dia);
    if (hoy >= presupuesto * PAUSA_DIA) {
      avisos.push({
        clave: `${dia}:pausa-dia`,
        titulo: "Gasto de IA fuera de lo normal",
        cuerpo: `Hoy van ${usd(hoy)} en Claude. Las demás cuentas se quedan sin IA hasta mañana; la tuya sigue.`,
        etiqueta: "gasto-ia-dia",
      });
    }
  }
  const dueno = idDueno(db);
  const porCuenta = db
    .select({ usuarioId: usoIa.usuarioId, nombre: usuarios.nombre, micro: sum(usoIa.costoMicroUsd) })
    .from(usoIa)
    .innerJoin(usuarios, eq(usuarios.id, usoIa.usuarioId))
    .where(eq(usoIa.dia, dia))
    .groupBy(usoIa.usuarioId)
    .all();
  for (const fila of porCuenta) {
    const costo = Number(fila.micro ?? 0) / 1e6;
    const propia = fila.usuarioId === dueno;
    const tope = propia ? limites.topeDiaDuenoUsd : limites.topeDiaUsd;
    if (!tope || costo < tope) continue;
    avisos.push({
      clave: `${dia}:cuenta:${fila.usuarioId}`,
      titulo: propia ? "Tu IA llegó a su tope de hoy" : `${fila.nombre} llegó a su tope de IA de hoy`,
      cuerpo: propia
        ? `Tu cuenta gastó ${usd(costo)} hoy en Claude. Si no fuiste tú, quita en Ajustes los dispositivos que no conozcas.`
        : `Gastó ${usd(costo)} hoy en Claude y ya no tiene IA hasta mañana. Si se repite, puede ser un abuso.`,
      etiqueta: `gasto-ia-${fila.usuarioId}`,
    });
  }
  return avisos.flatMap(({ clave, ...aviso }) => (primeraVez(db, `aviso-gasto-ia:${clave}`) ? [aviso] : []));
}
