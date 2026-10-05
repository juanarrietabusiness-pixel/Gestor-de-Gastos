/**
 * El consejero: preguntarle a Claude sobre esta plata.
 *
 * Lo que hace util a esto no es el modelo, es el contexto: del otro lado el
 * Worker le manda los numeros de este hogar ya calculados (ver
 * worker/routes/consejo.ts). Preguntar "¿me conviene invertir?" en un chat
 * generico da un ensayo; preguntarlo aca da una respuesta con los montos
 * propios.
 *
 * La conversacion NO se guarda. Vive mientras la pantalla este abierta, a
 * proposito: es una consulta, no un historial que despues haya que administrar,
 * y cada pregunta se manda con el contexto del dia.
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store.tsx';
import { Icono, Tarjeta, Vacio } from '../components/ui/base.tsx';
import { cn } from '../lib/utils.ts';

interface Mensaje {
  rol: 'yo' | 'claude';
  texto: string;
}

/** Preguntas para arrancar. Son las que se hacen mirando esta pantalla. */
const SUGERENCIAS = [
  '¿Cómo venimos este mes?',
  '¿Qué jarra está peor y qué hago?',
  '¿Ya podemos invertir algo o todavía no?',
  '¿El negocio está dando o lo estamos financiando?',
];

export function Consejero() {
  const { avisar } = useStore();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [pregunta, setPregunta] = useState('');
  const [pensando, setPensando] = useState(false);
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  /** Para poder cortar una respuesta a mitad de camino. */
  const cortarRef = useRef<AbortController | null>(null);
  /**
   * Si el auto-scroll puede moverse.
   *
   * Se pega al final SOLO si ya estabas al final. Antes bajaba en cada
   * fragmento que llegaba, asi que si subias a releer algo de arriba mientras
   * escribia, la pantalla te arrastraba de nuevo abajo cada pocos caracteres y
   * no habia forma de leer nada hasta que terminara.
   */
  const pegadoAbajo = useRef(true);

  useEffect(() => {
    fetch('/api/consejo/estado', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: { disponible: boolean }) => setDisponible(d.disponible))
      .catch(() => setDisponible(false));
  }, []);

  // Se mira cuanto falta para el fondo. 120px de tolerancia: leer el ultimo
  // renglon no cuenta como haberse ido para arriba.
  useEffect(() => {
    const alDesplazar = () => {
      const falta = document.documentElement.scrollHeight
        - window.scrollY - window.innerHeight;
      pegadoAbajo.current = falta < 120;
    };
    window.addEventListener('scroll', alDesplazar, { passive: true });
    return () => window.removeEventListener('scroll', alDesplazar);
  }, []);

  useEffect(() => {
    if (!pegadoAbajo.current) return;
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensajes]);

  /** Cortar la respuesta a mitad de camino. Lo escrito hasta ahi se queda. */
  function cortar() {
    cortarRef.current?.abort();
  }

  async function enviar(texto: string) {
    const limpio = texto.trim();
    if (!limpio || pensando) return;

    // La pregunta y el hueco de la respuesta entran juntos: el hueco se va
    // llenando con lo que llega, asi se lee mientras se escribe.
    const conMiPregunta: Mensaje[] = [...mensajes, { rol: 'yo', texto: limpio }];
    setMensajes([...conMiPregunta, { rol: 'claude', texto: '' }]);
    setPregunta('');
    setPensando(true);
    // Al mandar siempre se baja: es tu propia pregunta, quieres verla.
    pegadoAbajo.current = true;

    const control = new AbortController();
    cortarRef.current = control;
    let acumulado = '';

    try {
      const res = await fetch('/api/consejo', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensajes: conMiPregunta }),
        signal: control.signal,
      });

      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({ error: 'No se pudo preguntar' }));
        throw new Error((d as { error?: string }).error ?? 'No se pudo preguntar');
      }

      const lector = res.body.getReader();
      const decodificar = new TextDecoder();

      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        acumulado += decodificar.decode(value, { stream: true });
        setMensajes((prev) => {
          const copia = [...prev];
          copia[copia.length - 1] = { rol: 'claude', texto: acumulado };
          return copia;
        });
      }

      /*
       * Una respuesta vacia dejaba los tres puntitos girando para siempre.
       *
       * Pasa cuando la corriente se cierra sin haber escrito nada —el modelo
       * declino la pregunta, o se corto del otro lado— y desde afuera es
       * indistinguible de «sigue pensando»: no hay error, no hay texto, y la
       * burbuja se queda animandose sin que nunca llegue nada.
       */
      if (!acumulado.trim()) {
        setMensajes((prev) => {
          const copia = [...prev];
          copia[copia.length - 1] = {
            rol: 'claude',
            texto: 'No llegó respuesta. Prueba a preguntarlo de otra forma.',
          };
          return copia;
        });
      }
    } catch (e) {
      // Cortar a mano no es un error: lo que alcanzo a escribir se queda tal
      // cual, que es justo para lo que se corta.
      if (control.signal.aborted) {
        if (!acumulado.trim()) setMensajes((prev) => prev.slice(0, -1));
      } else {
        // Se saca el hueco vacio: dejarlo daria la impresion de una respuesta
        // que no llego nunca.
        setMensajes((prev) => prev.slice(0, -1));
        avisar(e instanceof Error ? e.message : 'No se pudo preguntar');
      }
    } finally {
      cortarRef.current = null;
      setPensando(false);
    }
  }

  if (disponible === false) {
    return (
      <div className="space-y-4">
        <h1 className="t-seccion font-semibold txt tracking-tight">Consejero</h1>
        <Tarjeta>
          <Vacio
            icono="sparkles"
            titulo="Falta la clave"
            texto="El consejero necesita una clave de la API de Claude cargada en los secretos de Cloudflare. Mientras tanto, el resto de la app funciona igual."
          />
          <p className="t-nota txt-3 text-center px-2 leading-relaxed -mt-2">
            Se carga una sola vez, desde la terminal:
            <br />
            <code className="t-nota">wrangler secret put ANTHROPIC_API_KEY</code>
          </p>
        </Tarjeta>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="t-seccion font-semibold txt tracking-tight">Consejero</h1>
        <p className="t-nota txt-3 mt-0.5">
          Ve todos tus números. La conversación no se guarda.
        </p>
      </div>

      {mensajes.length === 0 ? (
        <Tarjeta className="space-y-2.5">
          <p className="t-fila txt-2 leading-relaxed mb-3">
            Preguntale lo que le preguntarías a alguien que tiene tus cuentas
            delante.
          </p>
          {SUGERENCIAS.map((s) => (
            <button
              key={s}
              onClick={() => void enviar(s)}
              className="w-full text-left superficie-2 borde border rounded-2xl px-3.5 min-h-11 py-2.5 t-fila txt-2 active:scale-[0.99] transition-transform"
            >
              {s}
            </button>
          ))}
        </Tarjeta>
      ) : (
        <div className="space-y-3">
          {mensajes.map((m, i) => (
            <div
              key={i}
              className={cn('flex', m.rol === 'yo' ? 'justify-end' : 'justify-start')}
            >
              <div className={cn(
                'max-w-[85%] rounded-2xl px-3.5 py-2.5 t-fila leading-relaxed whitespace-pre-wrap',
                m.rol === 'yo'
                  ? 'bg-marca-600 text-white'
                  : 'superficie borde border txt',
              )}>
                {m.texto || (
                  <span className="inline-flex gap-1 py-1" aria-label="Pensando">
                    {[0, 1, 2].map((p) => (
                      <span
                        key={p}
                        className="w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-pulse"
                        style={{ animationDelay: `${p * 150}ms` }}
                      />
                    ))}
                  </span>
                )}
              </div>
            </div>
          ))}
          <div ref={finRef} />
        </div>
      )}

      {/* El compositor.
          El campo ya NO se deshabilita mientras responde: se puede ir
          escribiendo la siguiente pregunta mientras se lee la anterior, que es
          lo que uno hace. Mandarla sigue estando bloqueado —`enviar` corta si
          `pensando`— así que no se pisan dos respuestas. */}
      <div className="flex gap-2 items-end sticky bottom-2">
        <input
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void enviar(pregunta); }}
          placeholder="Pregunta algo..."
          enterKeyHint="send"
          aria-label="Tu pregunta"
          className="flex-1 min-w-0 min-h-12 px-4 rounded-2xl superficie borde border txt t-campo outline-none focus:border-marca-500"
        />
        {/* Redondo y del tamaño del campo, con la flecha adentro: es la forma
            que tiene este botón en cualquier chat, y además el ícono que pedía
            —«arrow-up»— no estaba registrado, así que hasta ahora dibujaba el
            genérico: un círculo vacío.

            Mientras responde se convierte en «detener», que es el mismo botón
            haciendo lo único que hace falta en ese momento. */}
        <button
          onClick={() => (pensando ? cortar() : void enviar(pregunta))}
          disabled={!pensando && pregunta.trim() === ''}
          aria-label={pensando ? 'Detener la respuesta' : 'Preguntar'}
          className={cn(
            'w-12 h-12 shrink-0 rounded-full flex items-center justify-center',
            'border border-white/15 shadow-md transition-all duration-100',
            'active:scale-[0.92] disabled:opacity-30 disabled:pointer-events-none',
            pensando
              ? 'superficie-2 borde txt-2 shadow-none'
              : 'bg-marca-600 text-white shadow-marca-600/30 hover:brightness-110',
          )}
        >
          <Icono nombre={pensando ? 'square' : 'arrow-up'} size={pensando ? 15 : 20} />
        </button>
      </div>

      {mensajes.length > 0 && !pensando && (
        <button
          onClick={() => setMensajes([])}
          className="w-full min-h-11 t-nota txt-3"
        >
          Empezar de nuevo
        </button>
      )}

      <p className="t-nota txt-3 text-center px-4 leading-relaxed">
        Orienta con tus números, pero no es un asesor matriculado. Las
        decisiones grandes conviene consultarlas con alguien que responda por
        ellas.
      </p>
    </div>
  );
}
