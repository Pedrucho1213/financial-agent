import { WifiOff } from "lucide-react";
import { type CSSProperties, lazy, Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { Toaster } from "sonner";
import { TabBar } from "./components/TabBar";
import { retomarPendientes } from "./lib/chat";
import { useEnLinea } from "./lib/conexion";
import { abrirEditor } from "./lib/editor";
import { navegar, useRuta } from "./lib/ruta";
import { useToken } from "./lib/sesion";
import { useTeclado } from "./lib/teclado";
import { Inicio } from "./pantallas/Inicio";
import { Movimientos } from "./pantallas/Movimientos";

// Inicio y Movimientos van en el paquete principal; lo demás se carga aparte
// (el service worker ya lo tiene guardado) para que la app abra más rápido.
const cargas = {
  chat: () => import("./pantallas/Chat"),
  ajustes: () => import("./pantallas/Ajustes"),
  editor: () => import("./pantallas/EditorMovimiento"),
  entrar: () => import("./pantallas/Entrar"),
  instalar: () => import("./pantallas/Instalar"),
  detalle: () => import("./pantallas/DetalleMovimiento"),
  mapa: () => import("./pantallas/Mapa"),
  plan: () => import("./pantallas/Plan"),
  analisis: () => import("./pantallas/Analisis"),
  cuentas: () => import("./pantallas/Cuentas"),
  etiquetas: () => import("./pantallas/Etiquetas"),
};
const Chat = lazy(() => cargas.chat().then((m) => ({ default: m.Chat })));
const Ajustes = lazy(() => cargas.ajustes().then((m) => ({ default: m.Ajustes })));
const EditorMovimiento = lazy(() => cargas.editor().then((m) => ({ default: m.EditorMovimiento })));
const Entrar = lazy(() => cargas.entrar().then((m) => ({ default: m.Entrar })));
const Instalar = lazy(() => cargas.instalar().then((m) => ({ default: m.Instalar })));
const DetalleMovimiento = lazy(() => cargas.detalle().then((m) => ({ default: m.DetalleMovimiento })));
const Mapa = lazy(() => cargas.mapa().then((m) => ({ default: m.Mapa })));
const Plan = lazy(() => cargas.plan().then((m) => ({ default: m.Plan })));
const Analisis = lazy(() => cargas.analisis().then((m) => ({ default: m.Analisis })));
const Cuentas = lazy(() => cargas.cuentas().then((m) => ({ default: m.Cuentas })));
const Cuenta = lazy(() => cargas.cuentas().then((m) => ({ default: m.Cuenta })));
const Etiquetas = lazy(() => cargas.etiquetas().then((m) => ({ default: m.Etiquetas })));

// /instalar?codigo=X instala el Atajo sin sesión: va antes de pedir la entrada y no toca el token.
const EN_INSTALAR = /^\/instalar\/?$/.test(window.location.pathname);

export function App() {
  const token = useToken();
  return (
    <>
      {EN_INSTALAR ? (
        <Suspense fallback={null}>
          <Instalar />
        </Suspense>
      ) : token ? (
        <Aplicacion />
      ) : (
        <Suspense fallback={null}>
          <Entrar />
        </Suspense>
      )}
      <Toaster
        position="top-center"
        // Debajo de la barra de arriba: así no tapan «Atrás» ni sus botones mientras se ven.
        offset={{ top: "calc(env(safe-area-inset-top) + 50px)" }}
        mobileOffset={{ top: "calc(env(safe-area-inset-top) + 50px)", left: "12px", right: "12px" }}
        gap={8}
        toastOptions={{
          duration: 4000,
          classNames: {
            toast: "!text-[15px]",
            description: "!text-muted-foreground !text-[15px]",
            actionButton: "!bg-transparent !text-tint !text-[15px] !font-semibold !h-8 !px-2",
          },
        }}
        style={
          {
            "--normal-bg": "var(--elevated)",
            "--normal-text": "var(--foreground)",
            "--normal-border": "var(--border)",
            "--border-radius": "16px",
          } as CSSProperties
        }
      />
    </>
  );
}

function Aplicacion() {
  const { pestana, pagina, params } = useRuta();
  const vista = pagina ?? pestana;
  const enLinea = useEnLinea();
  const teclado = useTeclado();

  // Ya con sesión, un ?codigo= viejo en la dirección sobra.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", `/${window.location.hash}`);
    retomarPendientes();
    // Al volver a la app (o al volver la red) se revisa lo que el chat dejó esperando.
    const alVolver = () => {
      if (document.visibilityState === "visible") retomarPendientes();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("online", alVolver);
    // Tocar una notificación: el service worker pide abrir una dirección de la app (#movimientos?detalle=…).
    const alMensaje = (e: MessageEvent) => {
      const d = e.data as { tipo?: string; url?: string } | null;
      if ((d?.tipo !== "fa:abrir" && d?.tipo !== "abrir") || typeof d?.url !== "string") return;
      const hash = d.url.slice(d.url.indexOf("#"));
      if (hash.startsWith("#")) navegar(hash);
    };
    navigator.serviceWorker?.addEventListener("message", alMensaje);
    // Precarga las otras pantallas cuando la app ya está quieta.
    const id = window.setTimeout(() => {
      void cargas.chat();
      void cargas.ajustes();
    }, 1200);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("online", alVolver);
      navigator.serviceWorker?.removeEventListener("message", alMensaje);
    };
  }, []);

  // Cada pestaña recuerda dónde se quedó, como en iOS.
  // Las páginas (detalle, mapa, plan, análisis, cuentas…) siempre abren arriba.
  const posiciones = useRef(new Map<string, number>());
  const anterior = useRef<string>(vista);
  useLayoutEffect(() => {
    if (anterior.current === vista) return;
    window.scrollTo(0, pagina ? 0 : (posiciones.current.get(vista) ?? 0));
    anterior.current = vista;
  }, [vista, pagina]);
  useEffect(() => {
    const guardar = () => posiciones.current.set(anterior.current, window.scrollY);
    window.addEventListener("fa:ruta", guardar, { capture: true });
    window.addEventListener("popstate", guardar, { capture: true });
    return () => {
      window.removeEventListener("fa:ruta", guardar, { capture: true });
      window.removeEventListener("popstate", guardar, { capture: true });
    };
  }, []);

  const conBoton = !pagina && (pestana === "inicio" || pestana === "movimientos");

  return (
    <div className="min-h-dvh pb-[calc(var(--barra-inferior)+28px)]">
      {!enLinea ? (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+50px)] z-40 flex justify-center px-4"
        >
          <span className="vidrio flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold">
            <WifiOff className="size-4 text-muted-foreground" />
            Sin conexión. Ves lo último guardado.
          </span>
        </div>
      ) : null}

      <main key={vista} className={pagina ? "animate-empujar" : "animate-aparecer"}>
        {pagina ? (
          <Suspense fallback={null}>
            {pagina === "movimiento" ? <DetalleMovimiento params={params} /> : null}
            {pagina === "mapa" ? <Mapa /> : null}
            {pagina === "plan" ? <Plan params={params} /> : null}
            {pagina === "analisis" ? <Analisis params={params} /> : null}
            {pagina === "cuentas" ? <Cuentas params={params} /> : null}
            {pagina === "cuenta" ? <Cuenta params={params} /> : null}
            {pagina === "etiquetas" ? <Etiquetas params={params} /> : null}
          </Suspense>
        ) : (
          <>
            {pestana === "inicio" ? <Inicio params={params} /> : null}
            {pestana === "movimientos" ? <Movimientos params={params} /> : null}
            <Suspense fallback={null}>
              {pestana === "chat" ? <Chat /> : null}
              {pestana === "ajustes" ? <Ajustes /> : null}
            </Suspense>
          </>
        )}
      </main>

      <TabBar
        actual={pestana}
        oculta={teclado}
        conBoton={conBoton}
        alAgregar={() => abrirEditor(null)}
        agregarDeshabilitado={!enLinea}
      />
      <Suspense fallback={null}>
        <EditorMovimiento />
      </Suspense>
    </div>
  );
}
