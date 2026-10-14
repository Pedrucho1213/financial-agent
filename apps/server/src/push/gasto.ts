import { idDueno } from "../auth";
import { avisosDeGasto, type LimitesIa } from "../ai/uso";
import type { Db } from "../db/client";
import { type EnviarPush, notificar } from "./notificaciones";

/** Después de cada llamada al modelo: si el gasto de Claude se dispara, le llega una notificación al dueño (ai/uso.ts). */
export function avisoDeGasto(db: Db, limites: LimitesIa | undefined, enviar?: EnviarPush) {
  return (dia: string) => {
    try {
      const dueno = idDueno(db);
      if (!dueno) return;
      for (const aviso of avisosDeGasto(db, dia, limites)) {
        // Sin esperar, pero sin dejar un rechazo suelto: tumbaría el servidor.
        notificar(db, dueno, { ...aviso, url: "/#sistema", urgencia: "high" }, enviar).catch((error) =>
          console.error("No se pudo mandar el aviso de gasto de IA:", error),
        );
      }
    } catch (error) {
      console.error("No se pudo revisar el gasto de IA:", error);
    }
  };
}
