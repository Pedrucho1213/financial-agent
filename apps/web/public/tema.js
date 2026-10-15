// El tema elegido en Ajustes › Apariencia, antes de pintar la página (después lo lleva src/lib/tema.ts).
// La barra de estado del iPhone se queda la normal en claro y en oscuro. Con black-translucent (antes, en oscuro) la
// app pasa debajo de la hora y desde iOS 26 el sistema le pone encima su propio difuminado: «Octubre», la campana y
// el título se veían apagados. Con la normal, iOS pinta la zona de la hora del color de la barra sólida de arriba.
try {
  var tema = localStorage.getItem("fa_tema");
  if (tema === "claro" || tema === "oscuro") document.documentElement.dataset.tema = tema;
  var barra = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (barra) barra.setAttribute("content", "default");
} catch (e) {}
