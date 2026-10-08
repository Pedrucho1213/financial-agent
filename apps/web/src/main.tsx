import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { clienteConsultas, guardarSinConexion, persistidor } from "./lib/consultas";
import "./index.css";

// Sin esto, Safari de iOS no aplica los estilos :active al tocar.
document.addEventListener("touchstart", () => undefined, { passive: true });

// Tras una actualización, el service worker nuevo borra los pedazos viejos y una pantalla
// que se carga aparte (Entrar tras un 401, por ejemplo) ya no existe: se recarga la app.
// Una sola vez por minuto, para no entrar en un ciclo si el problema es otro. Sin red no se
// recarga: solo dejaría la página de error del navegador en vez de lo último guardado.
window.addEventListener("vite:preloadError", (evento) => {
  if (!navigator.onLine) return;
  try {
    const ultima = Number(sessionStorage.getItem("fa_recarga") ?? 0);
    if (Date.now() - ultima < 60_000) return;
    sessionStorage.setItem("fa_recarga", String(Date.now()));
  } catch {
    // sin sessionStorage, se recarga igual
  }
  evento.preventDefault();
  window.location.reload();
});

const raiz = document.getElementById("root");
if (!raiz) throw new Error("Falta #root");

createRoot(raiz).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={clienteConsultas}
      persistOptions={{
        persister: persistidor,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        buster: "1",
        dehydrateOptions: { shouldDehydrateQuery: guardarSinConexion },
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);
