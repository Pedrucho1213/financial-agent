import { useRef } from "react";

/**
 * Un envío a la vez. `isPending` llega con el siguiente render: un doble toque rápido alcanza a
 * mandar dos POST (y mover el dinero dos veces). La ref se pone antes del primer await.
 */
export function useUnaVez() {
  const enviando = useRef(false);
  return async (fn: () => Promise<void>) => {
    if (enviando.current) return;
    enviando.current = true;
    try {
      await fn();
    } finally {
      enviando.current = false;
    }
  };
}
