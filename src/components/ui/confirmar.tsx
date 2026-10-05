/**
 * Confirmacion antes de borrar.
 *
 * Un solo mecanismo para toda la app: si algo se borra, pasa por aca. Devuelve
 * una promesa, asi el codigo que llama se lee de corrido en vez de partirse en
 * callbacks:
 *
 *   if (await confirmar({ titulo: 'Borrar el gasto?' })) await borrarTx(id);
 *
 * El boton de confirmar NO es el que queda debajo del pulgar por costumbre: el
 * de cancelar va a la derecha, que es donde cae el dedo al cerrar cosas sin
 * pensar. Para borrar hay que estirarse un poco.
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Boton, Icono } from './base.tsx';
import { cn } from '../../lib/utils.ts';

export interface PedidoConfirmacion {
  titulo: string;
  /** Que se pierde exactamente. Cuanto mas concreto, mejor decide la persona. */
  detalle?: string;
  confirmar?: string;
  cancelar?: string;
  /**
   * Una tercera salida, para cuando la pregunta no es si/no sino a donde.
   *
   * Existe por la papelera: «¿a la papelera o al archivo?» tiene tres
   * respuestas, porque tocar afuera tiene que ser «ninguna de las dos» y no
   * archivar por descarte.
   */
  alterna?: string;
  /** true para borrados; pinta el boton de rojo. */
  destructivo?: boolean;
}

/** Que eligieron. `false` es tambien lo que sale al tocar afuera o escapar. */
export type Respuesta = true | false | 'alterna';

type Resolver = (r: Respuesta) => void;

const Ctx = createContext<((p: PedidoConfirmacion) => Promise<Respuesta>) | null>(null);

export function ProveedorConfirmacion({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<PedidoConfirmacion | null>(null);
  const [resolver, setResolver] = useState<{ fn: Resolver } | null>(null);

  const confirmar = useCallback((p: PedidoConfirmacion) => {
    setPedido(p);
    return new Promise<Respuesta>((resolve) => setResolver({ fn: resolve }));
  }, []);

  const responder = (ok: Respuesta) => {
    resolver?.fn(ok);
    setPedido(null);
    setResolver(null);
  };

  return (
    <Ctx.Provider value={confirmar}>
      {children}

      {pedido && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center sm:justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
            onClick={() => responder(false)}
            aria-hidden
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={pedido.titulo}
            className={cn(
              'relative w-full sm:max-w-sm superficie rounded-3xl p-5 safe-bottom',
              'animate-[aparecer_.18s_cubic-bezier(.32,.72,0,1)]',
            )}
          >
            <div className="flex items-start gap-3.5 mb-5">
              <div className={cn(
                'w-11 h-11 rounded-2xl flex items-center justify-center shrink-0',
                pedido.destructivo ? 'bg-red-500/15 text-red-500' : 'bg-marca-500/15 text-marca-600',
              )}>
                <Icono nombre={pedido.destructivo ? 'trash-2' : 'circle-help'} size={20} />
              </div>
              <div className="min-w-0 pt-0.5">
                <h2 className="t-seccion font-semibold txt leading-snug">{pedido.titulo}</h2>
                {pedido.detalle && (
                  <p className="t-fila txt-2 mt-1.5 leading-relaxed">{pedido.detalle}</p>
                )}
              </div>
            </div>

            {/* Con tres salidas van apiladas: en una fila de tres, a 320px
                cada boton queda en 90px y los tres textos se cortan. */}
            {pedido.alterna ? (
              <div className="space-y-2">
                <Boton
                  variante={pedido.destructivo ? 'peligro' : 'primario'}
                  onClick={() => responder(true)}
                  className="w-full min-h-12"
                >
                  {pedido.confirmar ?? 'Confirmar'}
                </Boton>
                <Boton variante="secundario" onClick={() => responder('alterna')} className="w-full min-h-12">
                  {pedido.alterna}
                </Boton>
                <Boton variante="fantasma" onClick={() => responder(false)} className="w-full min-h-11">
                  {pedido.cancelar ?? 'Cancelar'}
                </Boton>
              </div>
            ) : (
              /* Cancelar a la derecha, donde cae el pulgar sin pensar. */
              <div className="flex gap-2">
                <Boton
                  variante={pedido.destructivo ? 'peligro' : 'primario'}
                  onClick={() => responder(true)}
                  className="flex-1 min-h-12"
                >
                  {pedido.confirmar ?? (pedido.destructivo ? 'Borrar' : 'Confirmar')}
                </Boton>
                <Boton variante="secundario" onClick={() => responder(false)} className="flex-1 min-h-12">
                  {pedido.cancelar ?? 'Cancelar'}
                </Boton>
              </div>
            )}
          </div>

          <style>{`@keyframes aparecer { from { opacity:0; transform: translateY(12px) scale(.97) } to { opacity:1; transform:none } }`}</style>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useConfirmar() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConfirmar necesita estar dentro de <ProveedorConfirmacion>');
  return ctx;
}
