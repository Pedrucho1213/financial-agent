/** iPhone o iPad (el iPad se presenta como Mac, pero con pantalla táctil). */
export function esIOS(ua = navigator.userAgent, toques = navigator.maxTouchPoints) {
  return /iPhone|iPod|iPad/i.test(ua) || (/Macintosh/i.test(ua) && toques > 1);
}

/** Abierta desde la pantalla de inicio (app web instalada), no en una pestaña de Safari. */
export function enPantallaDeInicio() {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}
