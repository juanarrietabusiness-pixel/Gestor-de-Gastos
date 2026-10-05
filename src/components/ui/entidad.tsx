/**
 * Selector de entidad, en la cabecera.
 *
 * Contempla las dos vistas que pidieron: cada economia por separado, y el
 * consolidado con etiquetas. "Todo" no es un filtro apagado, es una vista
 * propia: es donde se ve que la casa esta financiando a los negocios.
 *
 * Vivia como una fila de pestañas arriba de cuatro pantallas y se comia 60px
 * de alto en cada una, por encima de los numeros. Es un estado, no una
 * seccion: ahora es una pastilla en la cabecera, del color de la economia, y
 * las opciones se despliegan debajo.
 */

import { useEffect, useRef, useState } from 'react';
import type { Entity } from '@shared/types';
import { useStore } from '../../store/store.tsx';
import { Icono } from './base.tsx';

import { cn } from '../../lib/utils.ts';

export function PastillaEntidad({ className }: { className?: string }) {
  const { entities, entidadActiva, verEntidad } = useStore();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  const visibles = entities.filter((e) => !e.archived);

  // Cerrar al tocar afuera o al escapar: un menu que se queda abierto tapando
  // la pantalla es peor que no tenerlo.
  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', afuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', afuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierto]);

  if (visibles.length < 2) return null;

  const actual = visibles.find((e) => e.id === entidadActiva);
  const opciones = [
    { id: null as string | null, nombre: 'Todo', color: null as string | null, icono: 'circle-ellipsis' },
    ...visibles.map((e) => ({
      id: e.id as string | null, nombre: e.name, color: e.color as string | null, icono: e.icon,
    })),
  ];

  return (
    <div ref={caja} className={cn('relative', className)}>
      <button
        onClick={() => setAbierto(!abierto)}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        className="min-h-9 pl-2.5 pr-2 rounded-full flex items-center gap-1.5 t-fila font-semibold
          superficie-2 borde border transition-transform active:scale-[0.96]"
        style={actual
          ? {
            background: `color-mix(in srgb, ${actual.color} 14%, var(--superficie))`,
            color: actual.color,
            borderColor: `color-mix(in srgb, ${actual.color} 28%, transparent)`,
          }
          : undefined}
      >
        {actual && <Icono nombre={actual.icon} size={14} />}
        <span className="truncate max-w-[9rem]">{actual?.name ?? 'Todo'}</span>
        <Icono nombre="chevron-down" size={14} className={cn('transition-transform', abierto && 'rotate-180')} />
      </button>

      {abierto && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1.5 z-50 min-w-[11rem] p-1 rounded-2xl
            superficie borde border shadow-[var(--shadow-flotante)]
            animate-[caer_.16s_cubic-bezier(.32,.72,0,1)]"
        >
          {opciones.map((o) => {
            const activa = entidadActiva === o.id;
            return (
              <button
                key={o.id ?? 'todo'}
                role="option"
                aria-selected={activa}
                onClick={() => { verEntidad(o.id); setAbierto(false); }}
                className={cn(
                  'w-full min-h-10 px-2.5 rounded-xl flex items-center gap-2.5 t-fila font-medium',
                  'text-left transition-colors active:superficie-2',
                  activa ? 'txt' : 'txt-2',
                )}
                style={activa && o.color
                  ? { background: `color-mix(in srgb, ${o.color} 14%, var(--superficie))`, color: o.color }
                  : activa ? { background: 'var(--superficie-2)' } : undefined}
              >
                <Icono nombre={o.icono} size={15} style={o.color ? { color: o.color } : undefined} />
                <span className="flex-1 truncate">{o.nombre}</span>
                {activa && <Icono nombre="check" size={14} />}
              </button>
            );
          })}
          <style>{`@keyframes caer { from { opacity: 0; transform: translateY(-6px) } to { opacity: 1; transform: none } }`}</style>
        </div>
      )}
    </div>
  );
}

/** La etiqueta de entidad que llevan los movimientos en la vista consolidada. */
export function EtiquetaEntidad({ entidad }: { entidad: Entity | undefined }) {
  if (!entidad) return null;
  return (
    <span
      className="t-nota font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ background: `${entidad.color}1f`, color: entidad.color }}
    >
      {entidad.name}
    </span>
  );
}

/**
 * Las opciones de un desplegable, agrupadas por economia.
 *
 * Existe porque con dos economias hay dos "Suscripciones" y dos "Publicidad", y
 * en un desplegable nativo se ven exactamente iguales: elegir la equivocada
 * manda el gasto a la economia equivocada, y de ahi a las jarras equivocadas.
 *
 * `<optgroup>` es la forma nativa de resolverlo: el sistema operativo lo dibuja
 * con el titulo del grupo, en iOS y en Android, sin inventar nada.
 *
 * Con una sola economia no agrupa: un unico titulo repetido no dice nada.
 */
export function OpcionesPorEconomia<T extends { id: string; name: string; entityId: string | null }>(
  { items }: { items: T[] },
) {
  const { entities } = useStore();
  const economias = entities.filter((e) => !e.archived);

  if (economias.length < 2) {
    return <>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</>;
  }

  const grupos = economias
    .map((e) => ({ economia: e, suyos: items.filter((x) => x.entityId === e.id) }))
    .filter((g) => g.suyos.length > 0);

  // Los que no cuelgan de ninguna economia viva van al final, dichos por su
  // nombre: esconderlos los volveria imposibles de arreglar.
  const sueltos = items.filter((x) => !economias.some((e) => e.id === x.entityId));

  return (
    <>
      {grupos.map(({ economia, suyos }) => (
        <optgroup key={economia.id} label={economia.name}>
          {suyos.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </optgroup>
      ))}
      {sueltos.length > 0 && (
        <optgroup label="Sin economía">
          {sueltos.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </optgroup>
      )}
    </>
  );
}
