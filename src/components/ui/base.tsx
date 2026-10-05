/**
 * Primitivas visuales. Todas pensadas para el pulgar: nada de blancos de
 * menos de 44px, que es el minimo que recomienda Apple para tocar sin errar.
 */

import {
  type ButtonHTMLAttributes, type ComponentPropsWithRef, type CSSProperties,
  type PointerEvent as EventoPuntero, type ReactNode, useEffect, useRef, useState,
} from 'react';
import { cn } from '../../lib/utils.ts';
import { X } from 'lucide-react';
import { GRUPOS_ICONO, ICONO_GENERICO, ICONOS } from './iconos.ts';

// --- iconos --------------------------------------------------------------

/**
 * Icono por nombre en kebab-case ('piggy-bank'), buscado en el registro
 * explicito de ./iconos.ts. Si el nombre no esta, cae en uno generico en vez
 * de romper la pantalla: los nombres vienen de la base y pueden quedar viejos.
 */
export function Icono({ nombre, size = 20, className, style }: {
  nombre: string; size?: number; className?: string; style?: CSSProperties;
}) {
  const Comp = ICONOS[nombre] ?? ICONO_GENERICO;
  return <Comp size={size} className={className} style={style} />;
}

// --- boton ---------------------------------------------------------------

type VarianteBoton = 'primario' | 'secundario' | 'fantasma' | 'peligro';

export function Boton({
  variante = 'primario', className, children, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteBoton }) {
  const estilos: Record<VarianteBoton, string> = {
    primario: 'bg-marca-600 text-white border border-white/15 shadow-md shadow-marca-600/30 hover:brightness-110 active:bg-marca-700 active:brightness-100',
    secundario: 'superficie-2 txt borde border shadow-sm hover:brightness-95 dark:hover:brightness-125 active:brightness-95',
    fantasma: 'txt-2 hover:superficie-2',
    peligro: 'bg-red-600 text-white border border-white/15 shadow-md shadow-red-600/25 hover:brightness-110 active:bg-red-700 active:brightness-100',
  };

  return (
    <button
      {...props}
      className={cn(
        'min-h-11 px-4 rounded-2xl font-semibold t-fila transition-all duration-100',
        'active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none',
        'flex items-center justify-center gap-2 select-none touch-manipulation',
        estilos[variante],
        className,
      )}
    >
      {children}
    </button>
  );
}

// --- campos --------------------------------------------------------------

export function Campo({
  etiqueta, error, className, ...props
}: ComponentPropsWithRef<'input'> & { etiqueta?: string; error?: string }) {
  return (
    <label className="block">
      {etiqueta && <span className="block t-nota font-medium txt-2 mb-1.5">{etiqueta}</span>}
      <input
        {...props}
        className={cn(
          'w-full min-w-0 max-w-full min-h-11 px-3.5 rounded-2xl superficie-2 borde border txt shadow-[inset_0_1px_2px_rgb(0_0_0/0.05)]',
          // 16px es el minimo que evita que iOS haga zoom al enfocar.
          't-campo outline-none transition-all duration-100',
          'focus:border-marca-500 focus:ring-4 focus:ring-marca-500/15',
          'placeholder:txt-3',
          error && 'border-red-500 focus:border-red-500 focus:ring-red-500/20',
          className,
        )}
      />
      {error && <span className="block t-nota text-red-500 mt-1">{error}</span>}
    </label>
  );
}

export function Selector({
  etiqueta, className, children, ...props
}: ComponentPropsWithRef<'select'> & { etiqueta?: string }) {
  return (
    <label className="block">
      {etiqueta && <span className="block t-nota font-medium txt-2 mb-1.5">{etiqueta}</span>}
      <select
        {...props}
        className={cn(
          'w-full min-h-11 px-3.5 rounded-2xl superficie-2 borde border txt t-campo shadow-[inset_0_1px_2px_rgb(0_0_0/0.05)]',
          'outline-none transition-all duration-100 focus:border-marca-500 focus:ring-4 focus:ring-marca-500/15',
          className,
        )}
      >
        {children}
      </select>
    </label>
  );
}

// --- contenedores --------------------------------------------------------

export function Tarjeta({ className, children, onClick }: {
  className?: string; children: ReactNode; onClick?: () => void;
}) {
  return (
    <div className={cn('superficie borde border rounded-3xl p-5 shadow-[var(--shadow-tarjeta)]', className)} onClick={onClick}>
      {children}
    </div>
  );
}

export function Vacio({ icono, titulo, texto, accion }: {
  icono: string; titulo: string; texto: string; accion?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="w-16 h-16 rounded-3xl superficie-2 flex items-center justify-center mb-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <Icono nombre={icono} size={28} className="txt-3" />
      </div>
      <h3 className="t-seccion font-semibold txt tracking-tight text-balance mb-1.5">{titulo}</h3>
      <p className="t-fila txt-2 max-w-xs leading-relaxed text-balance mb-5">{texto}</p>
      {accion}
    </div>
  );
}

/**
 * Barra de progreso.
 *
 * Con `alerta` (presupuestos) el color no salta de golpe: vira gradualmente
 * hacia el rojo a medida que se acerca al tope. Un salto binario avisa cuando
 * ya es tarde; el degradado deja verlo venir.
 *
 * El viraje arranca al 60% y no antes, porque gastar la mitad del presupuesto
 * a mitad de mes es exactamente lo normal y pintarlo de amarillo seria mentir.
 */
/**
 * `alerta` y `fina` son dos barras distintas a proposito.
 *
 * Gruesa con alerta = un TOPE: cuanto queda antes de pasarse, y por eso vira a
 * rojo. Fina y tenue = una PARTE de un total: cuanto de lo gastado se fue en
 * esto, donde no hay nada que exceder y el color es solo identidad.
 *
 * Se veian iguales, y en el Inicio quedaban pegadas: la barra roja de "Comida
 * pasandose del presupuesto" y, tres centimetros abajo, la barra roja de "la
 * categoria Comida es de color rojo". Dos rojos juntos que significaban cosas
 * distintas.
 */
export function Barra({ ratio, color = '#10b981', alerta = false, fina = false }: {
  ratio: number; color?: string; alerta?: boolean; fina?: boolean;
}) {
  const pct = Math.min(Math.max(ratio, 0), 1) * 100;
  const excedido = ratio > 1;

  let fondo = color;
  if (alerta) {
    if (excedido) {
      fondo = '#ef4444';
    } else if (ratio > 0.6) {
      // De su color al rojo, pasando por ambar. El degradado ocupa el tramo
      // final de la barra, asi que el rojo aparece en la punta que avanza.
      const avance = Math.min((ratio - 0.6) / 0.4, 1);
      const medio = mezclar(color, '#f59e0b', Math.min(avance * 2, 1));
      const punta = avance > 0.5 ? mezclar('#f59e0b', '#ef4444', (avance - 0.5) * 2) : medio;
      fondo = `linear-gradient(90deg, ${color} 0%, ${medio} 55%, ${punta} 100%)`;
    }
  } else if (excedido) {
    fondo = '#ef4444';
  }

  return (
    <div className={cn(
      'rounded-full superficie-2 overflow-hidden',
      fina ? 'h-1' : 'h-2 shadow-[inset_0_1px_2px_rgb(0_0_0/0.08)]',
    )}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${pct}%`,
          background: fondo,
          opacity: fina ? 0.65 : 1,
          boxShadow: fina ? undefined : 'inset 0 1px 0 rgb(255 255 255 / 0.35)',
        }}
      />
    </div>
  );
}

/** Mezcla dos colores hexadecimales. t=0 devuelve el primero, t=1 el segundo. */
function mezclar(a: string, b: string, t: number): string {
  const leer = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = leer(a);
  const [r2, g2, b2] = leer(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * Math.min(Math.max(t, 0), 1));
  return `#${[m(r1, r2), m(g1, g2), m(b1, b2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Cuadrito de color con un icono adentro. Usa .ficha: el glifo se oscurece en
    claro y se aclara en oscuro para mantener ≥3:1 en los 24 colores. */
export function Ficha({ color, icono, size = 40 }: { color: string; icono: string; size?: number }) {
  return (
    <div
      className="ficha rounded-2xl flex items-center justify-center shrink-0 shadow-sm"
      style={{ width: size, height: size, ['--c' as string]: color }}
    >
      <Icono nombre={icono} size={size * 0.5} />
    </div>
  );
}

export function Avatar({ nombre, color, emoji, foto, size = 32 }: {
  nombre: string; color: string; emoji?: string; foto?: string; size?: number;
}) {
  // Manda la foto, despues el emoji, y al final las iniciales. El tamaño de
  // fuente es mayor para el emoji porque las iniciales ocupan mas ancho que
  // alto.
  const ini = nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');

  if (foto) {
    return (
      <img
        src={foto}
        alt={nombre}
        width={size}
        height={size}
        className="rounded-full object-cover shrink-0 select-none"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="ficha rounded-full flex items-center justify-center font-semibold shrink-0 select-none"
      style={{
        width: size, height: size,
        ['--c' as string]: color,
        fontSize: emoji ? size * 0.55 : size * 0.38,
        lineHeight: 1,
      }}
    >
      {emoji || ini}
    </div>
  );
}

/**
 * Elegir el icono de una categoria.
 *
 * Solo ofrece los del registro explicito (ver ./iconos.ts): si dejara escribir
 * cualquier nombre, la mitad caeria en el generico porque el empaquetador solo
 * incluye los que estan declarados.
 *
 * Agrupado por tema, y sin los iconos de la interfaz. Antes mostraba el
 * registro entero, asi que para elegir "comida" habia que pasar por flechas,
 * cruces y engranajes que no representan ningun gasto.
 */
export function SelectorIcono({ valor, alElegir, color }: {
  valor: string; alElegir: (n: string) => void; color: string;
}) {
  return (
    <div className="max-h-56 overflow-y-auto sin-barra space-y-2.5">
      {GRUPOS_ICONO.map(({ grupo, iconos }) => (
        <div key={grupo}>
          <p className="t-nota font-medium txt-3 mb-1 px-0.5">{grupo}</p>
          <div className="grid grid-cols-8 gap-1.5">
            {iconos.map((n) => (
              <button
                key={n}
                onClick={() => alElegir(n)}
                aria-label={`Icono ${n}`}
                className={cn(
                  'aspect-square rounded-xl flex items-center justify-center transition-all duration-100 active:scale-[0.97]',
                  valor === n ? 'shadow-sm' : 'superficie-2 txt-2',
                )}
                style={valor === n
                  ? {
                    background: `color-mix(in srgb, ${color} 14%, var(--superficie))`,
                    color: `color-mix(in srgb, ${color} 70%, #1c1c1e)`,
                    boxShadow: `0 0 0 2px ${color}`,
                  }
                  : undefined}
              >
                <Icono nombre={n} size={17} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Paleta compartida por cuentas, categorias, jarras y personas.
 *
 * Ordenada por tono y no por gusto: buscando "algo verde" o "algo naranja" se
 * llega derecho, que es como se elige de verdad. Las ocho primeras de la
 * version anterior siguen estando todas, asi que lo ya elegido se sigue
 * reconociendo como propio en vez de aparecer como un color suelto.
 *
 * Ninguna es tan oscura como para perderse contra el fondo negro ni tan clara
 * como para perderse contra el blanco: se usan de relleno al 15% y tambien
 * como punto solido.
 */
export const COLORES = [
  '#10b981', '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316',
  '#ef4444', '#f43f5e', '#ec4899', '#d946ef', '#a855f7', '#8b5cf6',
  '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6', '#059669',
  '#b45309', '#92400e', '#be123c', '#0369a1', '#78716c', '#64748b',
] as const;

export function SelectorColor({ valor, alElegir }: {
  valor: string; alElegir: (c: string) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {COLORES.map((c) => (
        <button
          key={c}
          onClick={() => alElegir(c)}
          aria-label={`Color ${c}`}
          className="w-9 h-9 rounded-xl transition-all duration-100 active:scale-[0.97] flex items-center justify-center shadow-sm"
          style={{ background: `color-mix(in srgb, ${c} 15%, var(--superficie))`, outline: valor === c ? `2px solid ${c}` : 'none' }}
        >
          <span className="w-4.5 h-4.5 rounded-lg shadow-sm" style={{ background: c }} />
        </button>
      ))}
    </div>
  );
}

/** Hoja que sube desde abajo. El patron nativo en celular. */
/**
 * Hoja a pantalla completa.
 *
 * Subia hasta el 92% de la altura dejando una franja del fondo asomando
 * arriba, que no servia para nada: no se podia tocar para cerrar y encima
 * recortaba los formularios largos. Ahora ocupa todo, con su cabecera pegada,
 * y entra deslizando desde abajo.
 *
 * `pie` es para la accion principal —Guardar— que se queda fija abajo en vez
 * de irse al final del scroll, donde en un formulario largo hay que bajar
 * hasta el fondo para encontrarla.
 */

// --- deslizar para actuar ------------------------------------------------

export interface AccionDeslizada {
  etiqueta: string;
  icono: string;
  alTocar: () => void;
  /** Rojo, para borrar. */
  peligro?: boolean;
}

/**
 * Una fila que se corre a la izquierda y deja ver sus acciones.
 *
 * Existe porque editar o borrar un movimiento eran tres toques: abrir el
 * detalle, buscar el boton, confirmar. Con una lista de cuarenta movimientos
 * eso es mucho para corregir un monto mal tipeado.
 *
 * Se abre con el dedo, pero NO se queda con cualquier gesto: solo si el
 * movimiento es claramente horizontal (mas del doble que el vertical) y hacia
 * la izquierda. Si no, el toque sigue siendo el scroll de siempre. Y las
 * acciones estan tambien en el detalle: esto es un atajo, no el unico camino.
 */
export function Deslizable({ acciones, children, className }: {
  acciones: AccionDeslizada[];
  children: ReactNode;
  className?: string;
}) {
  const ANCHO = 72;
  const total = ANCHO * acciones.length;

  const [dx, setDx] = useState(0);
  const [animando, setAnimando] = useState(false);
  const inicio = useRef<{ x: number; y: number; base: number } | null>(null);
  // Hasta saber si el gesto es horizontal o vertical no se toca nada: si se
  // decidiera en el primer pixel, bajar la lista abriria filas sin querer.
  const decidido = useRef<'no' | 'horizontal' | 'vertical'>('no');
  // Soltar el dedo despues de arrastrar dispara un `click` igual. Sin esto,
  // ese click caia en el manejador de abajo y cerraba la fila en el mismo
  // gesto que la abrio: se veia abrirse y cerrarse sola.
  const fueArrastre = useRef(false);

  if (acciones.length === 0) return <>{children}</>;

  const empezar = (e: EventoPuntero<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    inicio.current = { x: e.clientX, y: e.clientY, base: dx };
    decidido.current = 'no';
    fueArrastre.current = false;
    setAnimando(false);
  };

  const mover = (e: EventoPuntero<HTMLDivElement>) => {
    const i = inicio.current;
    if (!i) return;
    const desdeX = e.clientX - i.x;
    const desdeY = e.clientY - i.y;

    if (decidido.current === 'no') {
      if (Math.abs(desdeX) < 8 && Math.abs(desdeY) < 8) return;
      decidido.current = Math.abs(desdeX) > Math.abs(desdeY) * 2 ? 'horizontal' : 'vertical';
      if (decidido.current === 'horizontal') {
        fueArrastre.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
    if (decidido.current !== 'horizontal') return;

    // Solo hacia la izquierda, y con un tope: mas alla de las acciones el
    // arrastre se frena en vez de irse de la pantalla.
    setDx(Math.max(-total, Math.min(0, i.base + desdeX)));
  };

  const soltar = () => {
    if (!inicio.current) return;
    inicio.current = null;
    if (decidido.current !== 'horizontal') return;
    setAnimando(true);
    setDx(dx < -total / 2.5 ? -total : 0);
  };

  const cerrar = () => { setAnimando(true); setDx(0); };

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {/* Las acciones, quietas detras. La fila se corre encima de ellas. */}
      <div className="absolute inset-y-0 right-0 flex" aria-hidden={dx === 0}>
        {acciones.map((a) => (
          <button
            key={a.etiqueta}
            onClick={() => { cerrar(); a.alTocar(); }}
            tabIndex={dx === 0 ? -1 : 0}
            aria-label={a.etiqueta}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 t-nota font-medium',
              a.peligro ? 'bg-red-500 text-white' : 'superficie-2 txt-2',
            )}
            style={{ width: ANCHO }}
          >
            <Icono nombre={a.icono} size={17} />
            {a.etiqueta}
          </button>
        ))}
      </div>

      <div
        onPointerDown={empezar}
        onPointerMove={mover}
        onPointerUp={soltar}
        onPointerCancel={soltar}
        // Abierta, el primer toque en la fila la cierra en vez de abrir el
        // detalle: es lo que hace cualquier lista del telefono. Pero el click
        // que viene de haber arrastrado no cuenta como toque, solo se descarta.
        onClickCapture={(e) => {
          if (!fueArrastre.current && dx === 0) return;
          e.preventDefault();
          e.stopPropagation();
          if (!fueArrastre.current) cerrar();
          fueArrastre.current = false;
        }}
        className={cn('relative superficie', animando && 'transition-transform duration-200 ease-out')}
        style={{ transform: `translateX(${dx}px)`, touchAction: 'pan-y' }}
      >
        {children}
      </div>
    </div>
  );
}

export function Hoja({ abierta, alCerrar, titulo, children, pie, accion }: {
  abierta: boolean; alCerrar: () => void; titulo: string; children: ReactNode;
  pie?: ReactNode;
  /** Un boton extra en la cabecera, a la izquierda del cerrar. */
  accion?: ReactNode;
}) {
  // Con la hoja abierta el fondo no se desplaza: en el celular el scroll se
  // "contagiaba" a la pagina de atras y al cerrar habias perdido el lugar.
  useEffect(() => {
    if (!abierta) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previo; };
  }, [abierta]);

  useEffect(() => {
    if (!abierta) return;
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [abierta, alCerrar]);

  if (!abierta) return null;

  return (
    <div className="fixed inset-0 z-50 flex sm:items-center sm:justify-center">
      <div
        className="hoja-scrim absolute inset-0 hidden sm:block"
        onClick={alCerrar}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={cn(
          'relative flex flex-col w-full h-full sm:h-auto sm:max-h-[92vh] sm:max-w-lg',
          'superficie sm:borde sm:border sm:rounded-3xl',
          'shadow-[var(--shadow-flotante)] animate-[subir_.26s_cubic-bezier(.32,.72,0,1)]',
        )}
      >
        <div className="shrink-0 barra-vidrio safe-top pt-3 pb-3 px-5 borde border-b sm:rounded-t-3xl">
          <div className="flex items-center justify-between gap-2">
            <h2 className="t-seccion font-semibold txt tracking-tight truncate">{titulo}</h2>
            <div className="flex items-center gap-2 shrink-0">
              {accion}
              <button
                onClick={alCerrar}
                aria-label="Cerrar"
                className="w-9 h-9 rounded-full superficie-2 flex items-center justify-center txt-2 active:scale-[0.92] transition-transform duration-100"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </div>
        {/* `overflow-x-hidden` a proposito: si un hijo se pasa de ancho —un
            campo de fecha con su calendario, una fila de fichas— la hoja
            entera se podia arrastrar de lado y se rompia la proporcion. Que
            se desplace algo a lo ancho es decision del hijo (una fila de
            fichas lo pide), no un accidente de la hoja. */}
        <div className={cn(
          'flex-1 overflow-y-auto overflow-x-hidden sin-barra px-5 py-4',
          !pie && 'safe-bottom',
        )}>
          {children}
        </div>
        {pie && (
          <div className="shrink-0 barra-vidrio borde border-t px-5 pt-3 pb-3 safe-bottom">
            {pie}
          </div>
        )}
      </div>

      <style>{`@keyframes subir { from { transform: translateY(100%) } to { transform: translateY(0) } }`}</style>
    </div>
  );
}
