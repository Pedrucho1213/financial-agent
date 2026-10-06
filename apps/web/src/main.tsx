import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { clienteConsultas, persistidor } from "./lib/consultas";
import "./index.css";

const raiz = document.getElementById("root");
if (!raiz) throw new Error("Falta #root");

createRoot(raiz).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={clienteConsultas}
      persistOptions={{ persister: persistidor, maxAge: 7 * 24 * 60 * 60 * 1000, buster: "1" }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);
