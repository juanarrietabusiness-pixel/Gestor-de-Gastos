/**
 * Armazon de la app. Conserva la estructura del repo original —barra inferior
 * en celular, barra lateral en pantalla grande— porque es la parte que
 * funcionaba bien, con tres arreglos:
 *
 * - La barra inferior respeta el area segura del iPhone (antes se metia debajo
 *   del indicador de inicio).
 * - Cada destino es un boton de 44px minimo, el tamaño que se puede tocar sin
 *   errar con el pulgar.
 * - Un indicador de conexion muestra si el tiempo real esta andando y si la
 *   otra persona esta mirando la app en este momento.
 */

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { LogOut, Plus } from 'lucide-react';
import { useStore } from '../../store/store.tsx';
import { cn } from '../../lib/utils.ts';
import { Avatar, Icono } from '../ui/base.tsx';
import { PastillaEntidad } from '../ui/entidad.tsx';

export type Solapa =
  | 'inicio' | 'cuentas' | 'jarras' | 'movimientos' | 'analisis' | 'consejero' | 'ajustes';

/**
 * A donde se puede ir.
 *
 * En la barra van los cinco lugares donde se MIRA plata. Los ajustes salieron
 * de ahi: se entra tocando la propia foto, que es donde uno va a buscar lo
 * suyo en cualquier app, y asi el quinto lugar queda libre para estadisticas,
 * que si es una pantalla de plata.
 */
const DESTINOS: { id: Solapa; etiqueta: string; icono: string; enBarra: boolean }[] = [
  { id: 'inicio', etiqueta: 'Inicio', icono: 'house', enBarra: true },
  { id: 'movimientos', etiqueta: 'Movimientos', icono: 'receipt-text', enBarra: true },
  { id: 'jarras', etiqueta: 'Jarras', icono: 'piggy-bank', enBarra: true },
  { id: 'cuentas', etiqueta: 'Cuentas', icono: 'wallet', enBarra: true },
  { id: 'analisis', etiqueta: 'Estadísticas', icono: 'chart-pie', enBarra: true },
  // Fuera de la barra. Al consejero se entra desde los ajustes; a los ajustes,
  // por la foto de perfil de la cabecera.
  { id: 'consejero', etiqueta: 'Consejero', icono: 'sparkles', enBarra: false },
  { id: 'ajustes', etiqueta: 'Ajustes', icono: 'settings', enBarra: false },
];

export function AppLayout({ solapa, alCambiar, alAgregar, children }: {
  solapa: Solapa;
  alCambiar: (s: Solapa) => void;
  alAgregar: () => void;
  children: ReactNode;
}) {
  const { me, members, online, estadoLive, salir } = useStore();

  /** Las pantallas donde elegir economia cambia los numeros. */
  const conEconomia = solapa === 'inicio' || solapa === 'movimientos'
    || solapa === 'jarras' || solapa === 'analisis';

  const pareja = members.find((m) => m.id !== me?.id);
  const parejaEnLinea = pareja ? online.includes(pareja.id) : false;
  const enBarra = DESTINOS.filter((d) => d.enBarra);

  // Compacta al bajar, se abre al subir. Histéresis para que no titile:
  // cerca del tope siempre abierta, pide un viaje mínimo, y espera 150ms
  // entre cambios. Sin movimiento reducido: siempre expandida.
  const [compacto, setCompacto] = useState(false);
  const ultimoY = useRef(0);
  const ultimoCambio = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCompacto(false);
      return;
    }
    ultimoY.current = window.scrollY;
    let turno = 0;
    const alDesplazar = () => {
      cancelAnimationFrame(turno);
      turno = requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - ultimoY.current;
        ultimoY.current = y;
        const ahora = performance.now();

        if (y < 40) {
          setCompacto((c) => {
            if (c) ultimoCambio.current = ahora;
            return false;
          });
          return;
        }
        if (ahora - ultimoCambio.current < 150) return;
        if (delta > 24) {
          setCompacto((c) => {
            if (!c) ultimoCambio.current = ahora;
            return true;
          });
        } else if (delta < -16) {
          setCompacto((c) => {
            if (c) ultimoCambio.current = ahora;
            return false;
          });
        }
      });
    };
    window.addEventListener('scroll', alDesplazar, { passive: true });
    return () => {
      cancelAnimationFrame(turno);
      window.removeEventListener('scroll', alDesplazar);
    };
  }, []);

  const irA = (s: Solapa) => {
    setCompacto(false);
    alCambiar(s);
  };

  // Analisis y Consejero no estan en la barra. Sin esto la luz se quedaba
  // sobre "Inicio" y parecia que estabas en Inicio estando en otro lado.
  const indice = enBarra.findIndex((d) => d.id === solapa);
  const enLaBarra = indice >= 0;
  const activa = enLaBarra ? indice : 0;
  const n = enBarra.length;

  return (
    <div className="min-h-dvh flex flex-col md:flex-row">
      {/* Barra lateral, solo en pantalla grande */}
      <aside className="hidden md:flex flex-col w-60 barra-vidrio borde border-r p-5 sticky top-0 h-dvh shrink-0 z-30">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 bg-marca-600 text-white border border-white/15 rounded-xl flex items-center justify-center shadow-md shadow-marca-600/25">
            <Icono nombre="wallet" size={18} />
          </div>
          <span className="t-seccion font-semibold txt tracking-tight">Nuestros gastos</span>
        </div>

        <PastillaEntidad className="mb-4" />

        <nav className="flex-1 space-y-1">
          {DESTINOS.map((d) => (
            <button
              key={d.id}
              onClick={() => alCambiar(d.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 min-h-11 rounded-xl t-fila font-medium transition-all duration-100',
                solapa === d.id ? 'bg-marca-600/12 text-marca-700 dark:bg-marca-500/15 dark:text-marca-100 font-semibold shadow-sm' : 'txt-2 hover:superficie-2 active:superficie-2',
              )}
            >
              <Icono nombre={d.icono} size={18} />
              {d.etiqueta}
            </button>
          ))}
        </nav>

        <button
          onClick={alAgregar}
          className="mt-6 bg-marca-600 hover:brightness-110 active:brightness-100 active:scale-[0.97] text-white border border-white/15 min-h-12 rounded-2xl font-semibold flex items-center justify-center gap-2 shadow-md shadow-marca-600/30 transition-all duration-100"
        >
          <Plus size={18} /> Registrar
        </button>

        <div className="mt-6 pt-5 borde border-t">
          <EstadoConexion estado={estadoLive} pareja={pareja?.displayName} enLinea={parejaEnLinea} />
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar nombre={me?.displayName ?? '?'} color={me?.color ?? '#10b981'} emoji={me?.emoji} foto={me?.photo} size={30} />
              <span className="t-fila font-medium txt truncate">{me?.displayName}</span>
            </div>
            <button
              onClick={() => void salir()}
              aria-label="Cerrar sesión"
              className="txt-3 hover:txt-2 p-2"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      {/* Contenido */}
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 pt-4 pb-40 md:pb-8 md:px-8 md:pt-8">
        {/* Encabezado movil.
            La economia activa es un estado, no una seccion: vive aca y no
            arriba de cada pantalla. El estado de la conexion solo aparece
            cuando hay algo que decir —conectando o sin conexion—; cuando todo
            anda, el punto verde sobre el avatar de la pareja ya lo dice. */}
        <div className="md:hidden flex items-center justify-between gap-2 mb-3 safe-top">
          {/* Solo donde la economia cambia lo que se ve. En Cuentas no manda
              —las cuentas estan mezcladas a proposito— y en Ajustes tampoco,
              asi que ahi la pastilla seria un control que no hace nada. */}
          {conEconomia && <PastillaEntidad />}
          <div className="flex items-center gap-2 ml-auto">
            {estadoLive !== 'conectado' && (
              <EstadoConexion estado={estadoLive} pareja={pareja?.displayName} enLinea={parejaEnLinea} />
            )}
            {pareja && (
              <div className="relative" title={parejaEnLinea ? `${pareja.displayName} está en línea` : pareja.displayName}>
                <Avatar nombre={pareja.displayName} color={pareja.color} emoji={pareja.emoji} foto={pareja.photo} size={30} />
                {parejaEnLinea && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-marca-500 ring-2 ring-[var(--fondo)]" />
                )}
              </div>
            )}
            {/* La propia foto es la puerta a los ajustes: es donde uno va a
                buscar lo suyo en cualquier app, y libera un lugar en la barra
                de abajo para una pantalla de plata. */}
            <button
              onClick={() => alCambiar('ajustes')}
              aria-label="Ajustes"
              className={cn(
                'rounded-full active:scale-[0.92] transition-transform duration-100',
                solapa === 'ajustes' && 'ring-2 ring-marca-500 ring-offset-2 ring-offset-[var(--fondo)]',
              )}
            >
              <Avatar nombre={me?.displayName ?? '?'} color={me?.color ?? '#10b981'} emoji={me?.emoji} foto={me?.photo} size={30} />
            </button>
          </div>
        </div>

        {children}
      </main>

      {/* Boton flotante, solo en celular.
          Justo encima de la barra, no flotando en el medio: a 128px del piso
          se posaba sobre la lista y tapaba los botones de la fila que tenia
          debajo —el check de un pago habitual, por ejemplo, no se podia
          tocar—. Acompaña a la barra cuando se encoge. */}
      <button
        onClick={alAgregar}
        aria-label="Registrar movimiento"
        className={cn(
          'md:hidden fixed right-4 w-13 h-13 rounded-full bg-marca-600 text-white',
          'border border-white/20 shadow-lg shadow-marca-600/30 flex items-center justify-center',
          'active:scale-[0.92] transition-[bottom,transform] duration-[280ms] z-30',
        )}
        style={{
          bottom: compacto
            ? 'calc(3.75rem + var(--piso))'
            : 'calc(5rem + var(--piso))',
          transitionTimingFunction: 'cubic-bezier(.32,.72,0,1)',
        }}
      >
        <Plus size={24} />
      </button>

      {/* Barra inferior flotante, solo en celular.
          Sin etiquetas: eran las que la hacian alta, y cinco iconos de casa,
          recibo, chanchito, billetera y engranaje no necesitan que les
          expliquen. Al bajar se encoge entera, como la de Instagram, en vez
          de esconder un texto que ya no existe. */}
      <nav
        className="md:hidden fixed inset-x-0 flex justify-center px-3 pointer-events-none z-30"
        style={{ bottom: 'var(--piso)' }}
      >
        <div className={cn(
          'barra-flotante pointer-events-auto relative w-full max-w-[430px] rounded-[26px] px-2',
          compacto ? 'py-0.5' : 'py-1.5',
        )}>
          <div className="relative flex w-full">
            {enLaBarra && (
              <span
                aria-hidden="true"
                className="luz-deslizante"
                style={{
                  width: `${100 / n}%`,
                  transform: `translateX(${activa * 100}%)`,
                }}
              />
            )}
            {enBarra.map((d) => (
              <button
                key={d.id}
                onClick={() => irA(d.id)}
                aria-current={solapa === d.id ? 'page' : undefined}
                aria-label={d.etiqueta}
                className={cn(
                  'relative z-10 flex-1 flex items-center justify-center min-w-12 rounded-2xl',
                  'transition-[height,transform,color] duration-[280ms] active:scale-[0.92]',
                  compacto ? 'h-11' : 'h-13',
                  solapa === d.id ? 'text-marca-600 dark:text-marca-500' : 'txt-3',
                )}
                style={{ transitionTimingFunction: 'cubic-bezier(.32,.72,0,1)' }}
              >
                <Icono
                  nombre={d.icono}
                  size={compacto ? 23 : 25}
                  className="transition-[width,height] duration-[280ms]"
                />
              </button>
            ))}
          </div>
        </div>
      </nav>
    </div>
  );
}

/**
 * Estado de la conexion. Mas util de lo que parece: dice si lo que se carga
 * esta llegando al otro telefono, y si la otra persona esta mirando ahora.
 */
function EstadoConexion({ estado, pareja, enLinea }: {
  estado: string; pareja?: string; enLinea: boolean;
}) {
  if (estado !== 'conectado') {
    return (
      <span className="inline-flex items-center gap-1.5 t-nota txt-3">
        <span className={cn('w-1.5 h-1.5 rounded-full', estado === 'conectando' ? 'bg-amber-500 animate-pulse' : 'bg-stone-400')} />
        {estado === 'conectando' ? 'Conectando...' : 'Sin conexión'}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 t-nota txt-3">
      <span className="w-1.5 h-1.5 rounded-full bg-marca-500" />
      {enLinea && pareja ? `${pareja} está en línea` : 'En vivo'}
    </span>
  );
}
