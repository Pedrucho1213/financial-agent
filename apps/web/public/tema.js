// El tema elegido en Ajustes › Apariencia, antes de pintar la página (después lo lleva src/lib/tema.ts).
try {
  var tema = localStorage.getItem("fa_tema");
  if (tema === "claro" || tema === "oscuro") document.documentElement.dataset.tema = tema;
} catch (e) {}
