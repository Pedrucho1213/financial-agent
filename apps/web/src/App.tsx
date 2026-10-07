import { WifiOff } from "lucide-react";
import { type CSSProperties, lazy, Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { Toaster } from "sonner";
import { TabBar } from "./components/TabBar";
import { retomarPendientes } from "./lib/chat";
import { useEnLinea } from "./lib/conexion";
import { abrirEditor } from "./lib/editor";
import { escucharNotificaciones } from "./lib/push";
import { navegar, type Pestana, useRuta } from "./lib/ruta";
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
};
const Chat = lazy(() => cargas.chat().then((m) => ({ default: m.Chat })));
const Ajustes = lazy(() => cargas.ajustes().then((m) => ({ default: m.Ajustes })));
const EditorMovimiento = lazy(() => cargas.editor().then((m) => ({ default: m.EditorMovimiento })));
const Entrar = lazy(() => cargas.entrar().then((m) => ({ default: m.Entrar })));
const Instalar = lazy(() => cargas.instalar().then((m) => ({ default: m.Instalar })));

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
        offset={{ top: "calc(env(safe-area-inset-top) + 10px)" }}
        mobileOffset={{ top: "calc(env(safe-area-inset-top) + 10px)", left: "12px", right: "12px" }}
        gap={8}
        toastOptions={{
          duration: 4000,
          classNames: {
            toast: "!rounded-2xl !shadow-[0_10px_40px_rgb(0_0_0/0.18)] !text-[15px] !backdrop-blur-xl",
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
  const { pestana, params } = useRuta();
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
    // Tocar una notificación con la app abierta lleva a su pantalla (el detalle de lo anotado).
    const dejarDeEscuchar = escucharNotificaciones((hash) => navegar(hash));
    // Precarga las otras pantallas cuando la app ya está quieta.
    const id = window.setTimeout(() => {
      void cargas.chat();
      void cargas.ajustes();
    }, 1200);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("online", alVolver);
      dejarDeEscuchar();
    };
  }, []);

  // Cada pestaña recuerda dónde se quedó, como en iOS.
  const posiciones = useRef(new Map<Pestana, number>());
  const anterior = useRef(pestana);
  useLayoutEffect(() => {
    if (anterior.current === pestana) return;
    window.scrollTo(0, posiciones.current.get(pestana) ?? 0);
    anterior.current = pestana;
  }, [pestana]);
  useEffect(() => {
    const guardar = () => posiciones.current.set(anterior.current, window.scrollY);
    window.addEventListener("fa:ruta", guardar, { capture: true });
    window.addEventListener("popstate", guardar, { capture: true });
    return () => {
      window.removeEventListener("fa:ruta", guardar, { capture: true });
      window.removeEventListener("popstate", guardar, { capture: true });
    };
  }, []);

  const conBoton = pestana === "inicio" || pestana === "movimientos";

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

      <main key={pestana} className="animate-aparecer">
        {pestana === "inicio" ? <Inicio params={params} /> : null}
        {pestana === "movimientos" ? <Movimientos params={params} /> : null}
        <Suspense fallback={null}>
          {pestana === "chat" ? <Chat /> : null}
          {pestana === "ajustes" ? <Ajustes /> : null}
        </Suspense>
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
