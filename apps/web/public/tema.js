// El tema elegido en Ajustes › Apariencia, antes de pintar la página (después lo lleva src/lib/tema.ts).
// En oscuro, la barra de estado del iPhone es transparente (black-translucent): la barra de vidrio de arriba
// pasa por debajo de la hora, como en el diseño. En claro se queda la normal: con black-translucent la hora
// sale en blanco y no se leería sobre el fondo claro.
try {
  var tema = localStorage.getItem("fa_tema");
  if (tema === "claro" || tema === "oscuro") document.documentElement.dataset.tema = tema;
  var oscuro = tema === "oscuro" || (tema !== "claro" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var barra = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (barra) barra.setAttribute("content", oscuro ? "black-translucent" : "default");
} catch (e) {}
