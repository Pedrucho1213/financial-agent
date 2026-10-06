import { Plus, WifiOff } from "lucide-react";
import { type CSSProperties, useEffect, useLayoutEffect, useRef } from "react";
import { Toaster } from "sonner";
import { TabBar } from "./components/TabBar";
import { retomarPendientes } from "./lib/chat";
import { useEnLinea } from "./lib/conexion";
import { abrirEditor } from "./lib/editor";
import { type Pestana, useRuta } from "./lib/ruta";
import { useToken } from "./lib/sesion";
import { useTeclado } from "./lib/teclado";
import { cn } from "./lib/utils";
import { Ajustes } from "./pantallas/Ajustes";
import { Chat } from "./pantallas/Chat";
import { EditorMovimiento } from "./pantallas/EditorMovimiento";
import { Entrar } from "./pantallas/Entrar";
import { Inicio } from "./pantallas/Inicio";
import { Movimientos } from "./pantallas/Movimientos";

export function App() {
  const token = useToken();
  return (
    <>
      {token ? <Aplicacion /> : <Entrar />}
      <Toaster
        position="top-center"
        offset={{ top: "calc(env(safe-area-inset-top) + 10px)" }}
        mobileOffset={{ top: "calc(env(safe-area-inset-top) + 10px)", left: "12px", right: "12px" }}
        gap={8}
        toastOptions={{
          duration: 4000,
          classNames: {
            toast: "!rounded-2xl !shadow-[0_10px_40px_rgb(0_0_0/0.18)] !text-[15px] !backdrop-blur-xl",
            actionButton: "!bg-transparent !text-tint !text-[15px] !font-semibold !h-8 !px-2",
          },
        }}
        style={
          {
            "--normal-bg": "color-mix(in srgb, var(--elevated) 92%, transparent)",
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
    <div
      className={cn(
        "min-h-dvh",
        conBoton ? "pb-[calc(49px+env(safe-area-inset-bottom)+88px)]" : "pb-[calc(49px+env(safe-area-inset-bottom)+28px)]",
      )}
    >
      {!enLinea ? (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+50px)] z-40 flex justify-center px-4"
        >
          <span className="material flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold shadow-lg ring-[0.5px] ring-separator">
            <WifiOff className="size-4 text-muted-foreground" />
            Sin conexión. Ves lo último guardado.
          </span>
        </div>
      ) : null}

      <main key={pestana} className="animate-aparecer">
        {pestana === "inicio" ? <Inicio params={params} /> : null}
        {pestana === "movimientos" ? <Movimientos params={params} /> : null}
        {pestana === "chat" ? <Chat /> : null}
        {pestana === "ajustes" ? <Ajustes /> : null}
      </main>

      <button
        type="button"
        aria-label="Agregar movimiento"
        disabled={!enLinea}
        onClick={() => abrirEditor(null)}
        className={cn(
          "fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[calc(49px+env(safe-area-inset-bottom)+16px)] z-20 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_24px_color-mix(in_srgb,var(--primary)_45%,transparent)] transition-[transform,opacity] duration-300 ease-ios active:scale-90 disabled:opacity-40",
          conBoton && !teclado ? "scale-100 opacity-100" : "pointer-events-none scale-50 opacity-0",
        )}
      >
        <Plus className="size-7" strokeWidth={2.4} />
      </button>

      <TabBar actual={pestana} oculta={teclado} />
      <EditorMovimiento />
    </div>
  );
}
