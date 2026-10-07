// Vibración corta al cruzar un umbral (borrar, refrescar, elegir).
// Android: navigator.vibrate. iOS 18+: tocar un <input type="checkbox" switch> produce
// el "tic" del sistema; es el único camino que Safari ofrece a una página web.

let etiqueta: HTMLLabelElement | null = null;

function interruptorIOS() {
  if (etiqueta) return etiqueta;
  const id = "fa-haptico";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  const label = document.createElement("label");
  label.htmlFor = id;
  label.setAttribute("aria-hidden", "true");
  for (const el of [input, label]) {
    el.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  }
  document.body.append(input, label);
  etiqueta = label;
  return label;
}

export function haptico() {
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(8);
      return;
    }
    // Con un campo enfocado no: el clic al interruptor cerraría el teclado.
    const activo = document.activeElement;
    if (activo instanceof HTMLInputElement || activo instanceof HTMLTextAreaElement) return;
    if (/iPhone|iPad/.test(navigator.userAgent)) interruptorIOS().click();
  } catch {
    // Sin vibración no pasa nada.
  }
}
