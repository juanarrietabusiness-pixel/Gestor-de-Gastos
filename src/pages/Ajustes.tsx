/**
 * Ajustes: perfil, la pareja, presupuestos, pagos habituales, categorias,
 * orden del Inicio, seguridad y exportacion.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store.tsx';
import { api } from '../api/client.ts';
import type { Descarte } from '../api/client.ts';
import { formatMonto, montoPlano, parseMonto } from '@shared/money';
import { claveMes, estadoPresupuestos, gastadoEnEvento } from '@shared/domain';
import { MIN_PASSWORD } from '@shared/kdf';
import {
  esEvento, SECCIONES_INICIO, SECCIONES_MOVIMIENTOS, SECCION_LABEL,
  SECCION_MOVIMIENTOS_LABEL, TEMA_LABEL, TEMAS, TX_TYPE_LABEL, TxType,
  type Budget, type Category, type Entity, type Tema,
} from '@shared/types';
import { fechaCorta } from '../lib/utils.ts';
import {
  Avatar, Barra, Boton, Campo, Ficha, Hoja, Icono, SelectorColor,
  SelectorIcono, Selector, Tarjeta, Vacio,
} from '../components/ui/base.tsx';
import { SelectorEmoji } from '../components/ui/emoji.tsx';
import { useConfirmar } from '../components/ui/confirmar.tsx';
import { PagosHabituales } from './ajustes/PagosHabituales.tsx';
import { cn } from '../lib/utils.ts';

type Hoja1 = null | 'invitar' | 'password' | 'presupuestos' | 'presupuesto' | 'movimientos'
  | 'habituales' | 'categorias' | 'entidades' | 'perfil' | 'inicio' | 'papelera';

export function Ajustes({ alVerConsejero }: {
  /** El consejero no esta en la barra de abajo: se entra por aca. */
  alVerConsejero?: () => void;
}) {
  const {
    me, members, household, categories, entities, budgets, accounts, transactions,
    recurring, papelera, guardarPerfil, salir,
  } = useStore();

  const enLaPapelera = papelera.categories.length + papelera.accounts.length
    + papelera.entities.length;
  const moneda = household?.currency ?? 'USD';

  const [hoja, setHoja] = useState<Hoja1>(null);
  const [presupuestoEdit, setPresupuestoEdit] = useState<Budget | null>(null);

  const mesActual = claveMes(Date.now());
  const delMes = useMemo(
    () => estadoPresupuestos(budgets, transactions, mesActual, categories),
    [budgets, transactions, mesActual, categories],
  );

  return (
    <div className="space-y-4">
      {/* Perfil y hogar */}
      <Tarjeta>
        <h2 className="t-seccion font-semibold txt mb-3.5">{household?.name ?? 'Nuestra casa'}</h2>
        <div className="space-y-2.5">
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => m.id === me?.id && setHoja('perfil')}
              disabled={m.id !== me?.id}
              className="w-full flex items-center gap-3 text-left disabled:cursor-default"
            >
              <Avatar nombre={m.displayName} color={m.color} emoji={m.emoji} foto={m.photo} size={38} />
              <div className="flex-1 min-w-0">
                <p className="t-fila font-medium txt truncate">
                  {m.displayName}
                  {m.id === me?.id && <span className="txt-3 font-normal"> (tú)</span>}
                </p>
                <p className="t-nota txt-3 truncate">{m.email}</p>
              </div>
              {m.id === me?.id && <Icono nombre="pencil" size={15} className="txt-3 shrink-0" />}
            </button>
          ))}
        </div>

        {members.length < 2 && (
          <Boton onClick={() => setHoja('invitar')} className="w-full mt-4">
            <Icono nombre="user-plus" size={17} /> Sumar a tu pareja
          </Boton>
        )}
      </Tarjeta>

      {/* Todo lo que no es el dia a dia vive aca, en una sola lista. Antes
          los presupuestos y los pagos habituales eran dos tarjetas abiertas
          que empujaban el resto de los ajustes fuera de la pantalla. */}
      <Tarjeta className="p-0 overflow-hidden">
        {alVerConsejero && (
          <Opcion
            icono="sparkles"
            color="#10b981"
            titulo="Consejero"
            detalle="Preguntale"
            alTocar={alVerConsejero}
          />
        )}
        <Opcion
          icono="scale"
          titulo="Presupuestos"
          detalle={delMes.length > 0 ? `${delMes.length} este mes` : 'Sin topes'}
          alTocar={() => setHoja('presupuestos')}
        />
        <Opcion
          icono="repeat"
          titulo="Pagos habituales"
          detalle={recurring.length > 0 ? `${recurring.length} activos` : 'Ninguno'}
          alTocar={() => setHoja('habituales')}
        />
        <Opcion
          icono="building-2"
          titulo="Economías"
          detalle={entities.filter((e) => !e.archived).map((e) => e.name).join(' · ')}
          alTocar={() => setHoja('entidades')}
        />
        <Opcion
          icono="tags"
          titulo="Categorías"
          detalle={`${categories.filter((c) => !c.archived).length} activas`}
          alTocar={() => setHoja('categorias')}
        />
        <Opcion
          icono="trash-2"
          titulo="Papelera"
          detalle={enLaPapelera > 0 ? `${enLaPapelera} adentro` : 'Vacía'}
          alTocar={() => setHoja('papelera')}
        />
        <Opcion icono="grip-vertical" titulo="Ordenar el inicio" alTocar={() => setHoja('inicio')} />
        <Opcion icono="grip-vertical" titulo="Ordenar movimientos" alTocar={() => setHoja('movimientos')} />
        <Opcion icono="lock" titulo="Cambiar contraseña" alTocar={() => setHoja('password')} />
        <Opcion
          icono="download"
          titulo="Exportar a CSV"
          detalle={`${transactions.length} movimientos`}
          alTocar={() => exportarCsv(transactions, categories, accounts, members, moneda)}
        />
      </Tarjeta>

      <Boton variante="secundario" onClick={() => void salir()} className="w-full">
        <Icono nombre="log-out" size={17} /> Cerrar sesión
      </Boton>

      <HojaPerfil abierta={hoja === 'perfil'} alCerrar={() => setHoja(null)} />
      <HojaOrden
        abierta={hoja === 'inicio'}
        alCerrar={() => setHoja(null)}
        titulo="Ordenar el inicio"
        todas={SECCIONES_INICIO}
        etiquetas={SECCION_LABEL}
        actual={me?.homeLayout ?? []}
        alGuardar={(orden) => guardarPerfil({ homeLayout: orden })}
      />
      <HojaOrden
        abierta={hoja === 'movimientos'}
        alCerrar={() => setHoja(null)}
        titulo="Ordenar movimientos"
        todas={SECCIONES_MOVIMIENTOS}
        etiquetas={SECCION_MOVIMIENTOS_LABEL}
        actual={me?.movesLayout ?? []}
        alGuardar={(orden) => guardarPerfil({ movesLayout: orden })}
      />
      <HojaInvitar abierta={hoja === 'invitar'} alCerrar={() => setHoja(null)} />
      <HojaPassword abierta={hoja === 'password'} alCerrar={() => setHoja(null)} />
      <HojaPresupuestos
        abierta={hoja === 'presupuestos'}
        alCerrar={() => setHoja(null)}
        alEditar={(b) => { setPresupuestoEdit(b); setHoja('presupuesto'); }}
      />
      <PagosHabituales abierta={hoja === 'habituales'} alCerrar={() => setHoja(null)} />
      <HojaPresupuesto
        abierta={hoja === 'presupuesto'}
        alCerrar={() => { setHoja('presupuestos'); setPresupuestoEdit(null); }}
        editando={presupuestoEdit}
      />
      <HojaEntidades abierta={hoja === 'entidades'} alCerrar={() => setHoja(null)} />
      <HojaPapelera abierta={hoja === 'papelera'} alCerrar={() => setHoja(null)} />
      <HojaCategorias abierta={hoja === 'categorias'} alCerrar={() => setHoja(null)} />
    </div>
  );
}

/**
 * Una fila de la lista. El color es para las dos primeras, que no configuran
 * nada sino que llevan a otra pantalla: sin eso se perdian entre los ajustes.
 */
function Opcion({ icono, titulo, detalle, color, alTocar }: {
  icono: string; titulo: string; detalle?: string; color?: string; alTocar: () => void;
}) {
  return (
    <button
      onClick={alTocar}
      className="w-full flex items-center gap-3 px-5 min-h-14 text-left border-b borde last:border-b-0 active:superficie-2 transition-colors"
    >
      <Icono
        nombre={icono}
        size={19}
        className={cn('shrink-0', !color && 'txt-2')}
        style={color ? { color } : undefined}
      />
      <span className="t-fila font-medium txt shrink-0">{titulo}</span>
      {/* El detalle cede primero: con tres economias listadas el nombre de la
          fila quedaba aplastado contra el icono. */}
      <span className="flex-1 min-w-0 t-nota txt-3 text-right truncate">{detalle}</span>
      <Icono nombre="chevron-right" size={17} className="txt-3 shrink-0" />
    </button>
  );
}

// --- perfil ---------------------------------------------------------------

function HojaPerfil({ abierta, alCerrar }: { abierta: boolean; alCerrar: () => void }) {
  const { me, guardarPerfil, avisar } = useStore();
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState('#10b981');
  const [emoji, setEmoji] = useState('');
  const [foto, setFoto] = useState('');
  const [tema, setTema] = useState<Tema>('auto');
  const [guardando, setGuardando] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!abierta || !me) return;
    setNombre(me.displayName);
    setColor(me.color);
    setEmoji(me.emoji);
    setFoto(me.photo);
    setTema(me.theme);
  }, [abierta, me]);

  /**
   * La foto se recorta y se achica ACA, en el navegador, antes de subirla.
   *
   * Sin esto una foto de camara son 4 MB que viajarian en cada snapshot, en
   * los dos telefonos, para dibujarse a 38 pixeles. Se recorta al cuadrado
   * central y se reduce a 256px, que es el doble de lo que hace falta en la
   * pantalla mas densa: unos 20 KB.
   */
  async function elegirFoto(file: File) {
    try {
      const bitmap = await createImageBitmap(file);
      const lado = Math.min(bitmap.width, bitmap.height);
      const lienzo = document.createElement('canvas');
      lienzo.width = 256;
      lienzo.height = 256;
      const ctx = lienzo.getContext('2d');
      if (!ctx) throw new Error('No se pudo procesar la imagen');
      ctx.drawImage(
        bitmap,
        (bitmap.width - lado) / 2, (bitmap.height - lado) / 2, lado, lado,
        0, 0, 256, 256,
      );
      bitmap.close();
      setFoto(lienzo.toDataURL('image/jpeg', 0.82));
    } catch {
      avisar('No se pudo leer esa imagen');
    }
  }

  return (
    <Hoja
      abierta={abierta}
      alCerrar={alCerrar}
      titulo="Tu perfil"
      pie={(
        <Boton
          onClick={async () => {
            setGuardando(true);
            try {
              await guardarPerfil({ displayName: nombre.trim(), color, emoji, photo: foto, theme: tema });
              alCerrar();
            } catch (e) {
              avisar(e instanceof Error ? e.message : 'No se pudo guardar');
            } finally {
              setGuardando(false);
            }
          }}
          disabled={!nombre.trim() || guardando}
          className="w-full min-h-12"
        >
          {guardando ? 'Guardando...' : 'Guardar'}
        </Boton>
      )}
    >
      <div className="space-y-5">
        <div className="flex flex-col items-center pt-1">
          <Avatar nombre={nombre || '?'} color={color} emoji={emoji} foto={foto} size={84} />
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => archivo.current?.click()}
              className="min-h-9 px-3 rounded-xl superficie-2 borde border t-nota font-medium txt-2 flex items-center gap-1.5"
            >
              <Icono nombre="camera" size={14} /> {foto ? 'Cambiar foto' : 'Subir foto'}
            </button>
            {foto && (
              <button
                onClick={() => setFoto('')}
                className="min-h-9 px-3 rounded-xl superficie-2 borde border t-nota font-medium txt-3"
              >
                Quitar
              </button>
            )}
          </div>
          <input
            ref={archivo}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void elegirFoto(f);
              e.target.value = '';
            }}
          />
          <p className="t-nota txt-3 mt-2">
            {foto ? 'La foto manda sobre el emoji' : 'Así te ven en la app'}
          </p>
        </div>

        <Campo etiqueta="Tu nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />

        <div>
          <span className="block t-nota font-medium txt-2 mb-2">Tema</span>
          {/* Guardado en tu perfil, no en el teléfono: tú y tu pareja pueden
              tener temas distintos, y el tuyo te sigue a donde entres. */}
          <div className="grid grid-cols-3 gap-2">
            {TEMAS.map((t) => (
              <button
                key={t}
                onClick={() => setTema(t)}
                className={cn(
                  'min-h-11 rounded-xl t-fila font-medium border transition-all',
                  tema === t ? 'bg-marca-600 text-white border-transparent' : 'superficie-2 borde txt-2',
                )}
              >
                {TEMA_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="block t-nota font-medium txt-2 mb-2">Color</span>
          <SelectorColor valor={color} alElegir={setColor} />
        </div>

        <div className={cn(foto && 'opacity-50 pointer-events-none')}>
          <span className="block t-nota font-medium txt-2 mb-2">
            Emoji {foto && '· lo tapa la foto'}
          </span>
          <SelectorEmoji valor={emoji} alElegir={setEmoji} color={color} />
        </div>
      </div>
    </Hoja>
  );
}

// --- orden del inicio -----------------------------------------------------

/**
 * Ordenar y ocultar las secciones del Inicio.
 *
 * Se mueve con flechas y no arrastrando. Arrastrar en una lista dentro de una
 * hoja que ya scrollea pelea con el scroll y en el celular termina siendo
 * frustrante; las flechas siempre hacen lo que dicen.
 */
/**
 * Acomodar las secciones de una pantalla: subirlas, bajarlas y ocultarlas.
 *
 * Sirve para el Inicio y para Movimientos, que es la misma idea sobre listas
 * distintas. Antes estaba escrita solo para el Inicio; copiarla habría dejado
 * dos versiones que se van separando en el primer retoque.
 */
function HojaOrden<T extends string>({
  abierta, alCerrar, titulo, todas, etiquetas, actual, alGuardar,
}: {
  abierta: boolean;
  alCerrar: () => void;
  titulo: string;
  todas: readonly T[];
  etiquetas: Record<T, string>;
  actual: T[];
  alGuardar: (orden: T[]) => Promise<void>;
}) {
  const { avisar } = useStore();
  const [orden, setOrden] = useState<T[]>([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierta) return;
    setOrden(actual.length ? actual : [...todas]);
  }, [abierta, actual, todas]);

  const ocultas = todas.filter((s) => !orden.includes(s));

  const mover = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= orden.length) return;
    const copia = [...orden];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    setOrden(copia);
  };

  return (
    <Hoja
      abierta={abierta}
      alCerrar={alCerrar}
      titulo={titulo}
      pie={(
        <div className="flex gap-2">
          <Boton variante="secundario" onClick={() => setOrden([...todas])} className="px-4">
            Restaurar
          </Boton>
          <Boton
            onClick={async () => {
              setGuardando(true);
              try {
                await alGuardar(orden);
                alCerrar();
              } catch (e) {
                avisar(e instanceof Error ? e.message : 'No se pudo guardar');
              } finally {
                setGuardando(false);
              }
            }}
            disabled={guardando}
            className="flex-1 min-h-12"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </Boton>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          {orden.map((s, i) => (
            <div key={s} className="flex items-center gap-2 superficie-2 rounded-xl p-2">
              <span className="flex-1 t-fila font-medium txt px-1.5 truncate">{etiquetas[s]}</span>
              <button
                onClick={() => mover(i, -1)}
                disabled={i === 0}
                aria-label={`Subir ${etiquetas[s]}`}
                className="w-9 h-9 rounded-lg superficie flex items-center justify-center txt-2 disabled:opacity-25"
              >
                <Icono nombre="chevron-up" size={16} />
              </button>
              <button
                onClick={() => mover(i, 1)}
                disabled={i === orden.length - 1}
                aria-label={`Bajar ${etiquetas[s]}`}
                className="w-9 h-9 rounded-lg superficie flex items-center justify-center txt-2 disabled:opacity-25"
              >
                <Icono nombre="chevron-down" size={16} />
              </button>
              <button
                onClick={() => setOrden(orden.filter((x) => x !== s))}
                aria-label={`Ocultar ${etiquetas[s]}`}
                className="w-9 h-9 rounded-lg superficie flex items-center justify-center txt-3"
              >
                <Icono nombre="eye" size={16} />
              </button>
            </div>
          ))}
        </div>

        {ocultas.length > 0 && (
          <div>
            <p className="t-nota font-medium txt-3 mb-2">Ocultas</p>
            <div className="flex gap-2 flex-wrap">
              {ocultas.map((s) => (
                <button
                  key={s}
                  onClick={() => setOrden([...orden, s])}
                  className="min-h-9 px-3 rounded-full superficie-2 borde border t-nota font-medium txt-2 flex items-center gap-1.5"
                >
                  <Icono nombre="plus" size={13} /> {etiquetas[s]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Hoja>
  );
}

// --- papelera -------------------------------------------------------------

const ETIQUETA_DESCARTE: Record<Descarte, string> = {
  categoria: 'Categoría',
  cuenta: 'Cuenta',
  economia: 'Economía',
};

/** Lo que sabemos de cada cosa tirada, ya cruzado con lo que dice el Worker. */
interface Tirado {
  tipo: Descarte;
  id: string;
  nombre: string;
  color: string;
  icon: string;
  trashedAt: number | null;
  trashedBy: string | null;
  /** Qué impide borrarla. null = se puede borrar. */
  motivo: string | null;
  /** Cuántos días le quedan. null = no se borra nunca (tiene historia). */
  dias: number | null;
}

/**
 * La papelera. Una sola.
 *
 * Antes había papelera Y archivo, y para elegir entre los dos había que saber
 * de antemano si la historia de eso iba a importar, que es justo lo que uno no
 * sabe en el momento de sacarlo de en medio. Ahora todo cae acá y el sistema
 * resuelve lo que se puede resolver solo: lo que no tiene historia se borra a
 * los 30 días, lo que sí la tiene se queda —eso es lo que hacía el archivo—,
 * y restaurar es un toque en cualquiera de los dos casos.
 */
function HojaPapelera({ abierta, alCerrar }: { abierta: boolean; alCerrar: () => void }) {
  const { papelera, restaurar, vaciarPapelera, avisar, members } = useStore();
  const confirmar = useConfirmar();
  const [trabajando, setTrabajando] = useState(false);
  /**
   * Qué ata a cada cosa y cuánto le queda. Lo dice el Worker, no el snapshot.
   *
   * `cargado` existe por un parpadeo: mientras la respuesta venía en camino,
   * `motivos` estaba vacío, así que TODO se dibujaba en «se borran solas», con
   * su casilla y con el botón de borrar al pie. Al llegar la respuesta, lo que
   * tiene historia se mudaba al otro grupo y la casilla y el botón desaparecían
   * en menos de un segundo, justo cuando el dedo iba hacia ellos.
   */
  const [datos, setDatos] = useState<{
    motivos: Record<string, string | null>;
    dias: Record<string, number | null>;
    plazo: number;
    cargado: boolean;
  }>({ motivos: {}, dias: {}, plazo: 30, cargado: false });
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  // Qué ata a cada cosa y cuánto le queda, para poder decirlo ANTES de que
  // toquen el botón en vez de que lo descubran cuando no se borra.
  useEffect(() => {
    if (!abierta) return;
    let vivo = true;
    void api.revisarPapelera()
      .then((r) => {
        if (!vivo) return;
        setDatos({
          motivos: Object.fromEntries(r.items.map((i) => [i.id, i.motivo])),
          dias: Object.fromEntries(r.items.map((i) => [i.id, i.diasQueQuedan])),
          plazo: r.diasHastaBorrar,
          cargado: true,
        });
      })
      .catch(() => { /* sin esto la pantalla sigue siendo usable */ });
    return () => { vivo = false; };
  }, [abierta, papelera]);

  useEffect(() => {
    if (abierta) return;
    setMarcados(new Set());
    setDatos((d) => ({ ...d, cargado: false }));
  }, [abierta]);

  const todo: Tirado[] = [
    ...papelera.categories.map((c) => ({ tipo: 'categoria' as Descarte, x: c })),
    ...papelera.accounts.map((c) => ({ tipo: 'cuenta' as Descarte, x: c })),
    ...papelera.entities.map((e) => ({ tipo: 'economia' as Descarte, x: e })),
  ]
    .map(({ tipo, x }) => ({
      tipo,
      id: x.id,
      nombre: x.name,
      color: x.color,
      icon: x.icon,
      trashedAt: x.trashedAt,
      trashedBy: x.trashedBy,
      motivo: datos.motivos[x.id] ?? null,
      dias: datos.dias[x.id] ?? null,
    }))
    .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));

  // Dos grupos, porque se comportan distinto: unas se van solas y otras no se
  // van nunca. Mezclarlas obligaba a leer cada renglón para saber cuál era cuál.
  // Antes de saber cuál es cuál no se parte nada: ver aparecer los dos grupos
  // ya armados es mejor que verlos rearmarse solos.
  const seVan = datos.cargado ? todo.filter((t) => t.motivo === null) : [];
  const seQuedan = datos.cargado ? todo.filter((t) => t.motivo !== null) : [];

  // Solo se puede borrar lo que no tiene historia, así que marcar lo otro no
  // haría nada: la casilla directamente no se dibuja.
  const marcadosBorrables = seVan.filter((t) => marcados.has(t.id));

  const alternar = (id: string) => setMarcados((previos) => {
    const v = new Set(previos);
    if (v.has(id)) v.delete(id); else v.add(id);
    return v;
  });

  async function traerDeVuelta(tipo: Descarte, id: string) {
    setTrabajando(true);
    try {
      await restaurar(tipo, id);
      setMarcados((previos) => {
        const v = new Set(previos);
        v.delete(id);
        return v;
      });
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo restaurar');
    } finally {
      setTrabajando(false);
    }
  }

  async function borrar(seleccion: Tirado[] | null) {
    const cuantos = seleccion ? seleccion.length : seVan.length;
    const ok = await confirmar({
      titulo: cuantos === 1 ? '¿Borrar esto?' : `¿Borrar ${cuantos} cosas?`,
      detalle: 'Se borra de verdad y no se puede deshacer.',
      confirmar: 'Borrar',
      destructivo: true,
    });
    if (!ok) return;

    setTrabajando(true);
    try {
      const r = await vaciarPapelera(
        seleccion ? seleccion.map((t) => ({ tipo: t.tipo, id: t.id })) : undefined,
      );
      setMarcados(new Set());
      avisar(
        r.borrados === 0 ? 'No había nada para borrar'
          : r.borrados === 1 ? 'Borrado' : `Se borraron ${r.borrados}`,
        'ok',
      );
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo borrar');
    } finally {
      setTrabajando(false);
    }
  }

  const quien = (id: string | null) =>
    members.find((m) => m.id === id)?.displayName ?? '';

  const fila = (t: Tirado, conCasilla: boolean) => (
    <div key={t.id} className="flex items-center gap-2.5 py-2">
      {conCasilla ? (
        <button
          onClick={() => alternar(t.id)}
          role="checkbox"
          aria-checked={marcados.has(t.id)}
          aria-label={`Marcar ${t.nombre}`}
          className={cn(
            'w-6 h-6 rounded-lg border shrink-0 flex items-center justify-center transition-colors',
            marcados.has(t.id)
              ? 'bg-marca-600 border-transparent text-white'
              : 'superficie-2 borde txt-3',
          )}
        >
          {marcados.has(t.id) && <Icono nombre="check" size={14} />}
        </button>
      ) : (
        <span className="w-6 shrink-0" aria-hidden />
      )}

      <Ficha color={t.color} icono={t.icon} size={34} />

      <div className="flex-1 min-w-0">
        <p className="t-fila font-medium txt truncate">{t.nombre}</p>
        <p className="t-nota txt-3 truncate">
          {[
            ETIQUETA_DESCARTE[t.tipo],
            t.trashedBy ? `la tiró ${quien(t.trashedBy)}` : null,
            t.trashedAt ? fechaCorta(t.trashedAt) : null,
          ].filter(Boolean).join(' · ')}
        </p>
        {/* Sin `truncate`: el motivo es la razon entera por la que algo no se
            borra, y cortado en «5 movimientos la u...» no explica nada. */}
        {t.motivo ? (
          <p className="t-nota txt-3 leading-snug">Se queda: {t.motivo}</p>
        ) : t.dias !== null && (
          <p className="t-nota text-amber-600 dark:text-amber-500">
            {t.dias === 0 ? 'Se borra hoy' : t.dias === 1 ? 'Se borra mañana' : `Se borra en ${t.dias} días`}
          </p>
        )}
      </div>

      <button
        onClick={() => void traerDeVuelta(t.tipo, t.id)}
        disabled={trabajando}
        aria-label={`Restaurar ${t.nombre}`}
        className="min-h-9 px-3 rounded-xl superficie-2 borde border t-nota font-medium txt-2 shrink-0 disabled:opacity-40"
      >
        Restaurar
      </button>
    </div>
  );

  return (
    <Hoja
      abierta={abierta}
      alCerrar={alCerrar}
      titulo="Papelera"
      pie={seVan.length > 0 ? (
        <Boton
          variante="peligro"
          onClick={() => void borrar(marcadosBorrables.length > 0 ? marcadosBorrables : null)}
          disabled={trabajando}
          className="w-full min-h-12"
        >
          <Icono nombre="trash-2" size={17} />
          {marcadosBorrables.length > 0
            ? `Borrar ${marcadosBorrables.length} ahora`
            : `Borrar las ${seVan.length} ahora`}
        </Boton>
      ) : undefined}
    >
      {!datos.cargado && todo.length > 0 ? (
        /* El mismo alto que van a ocupar las filas, para que no salte. */
        <div className="divide-y divide-[var(--borde)]">
          {todo.map((t) => (
            <div key={t.id} className="flex items-center gap-2.5 py-2 opacity-50">
              <span className="w-6 shrink-0" aria-hidden />
              <Ficha color={t.color} icono={t.icon} size={34} />
              <div className="flex-1 min-w-0">
                <p className="t-fila font-medium txt truncate">{t.nombre}</p>
                <p className="t-nota txt-3">{ETIQUETA_DESCARTE[t.tipo]}</p>
              </div>
            </div>
          ))}
        </div>
      ) : todo.length === 0 ? (
        <Vacio
          icono="trash-2"
          titulo="Papelera vacía"
          texto={`Lo que tires acá se borra solo a los ${datos.plazo} días.`}
        />
      ) : (
        <div className="space-y-6">
          {seVan.length > 0 && (
            <div>
              <p className="t-nota font-medium txt-3 mb-2 px-1">
                Se borran solas · {seVan.length}
              </p>
              <div className="divide-y divide-[var(--borde)]">
                {seVan.map((t) => fila(t, true))}
              </div>
            </div>
          )}

          {seQuedan.length > 0 && (
            <div>
              <p className="t-nota font-medium txt-3 mb-2 px-1">
                Se quedan · {seQuedan.length}
              </p>
              <div className="divide-y divide-[var(--borde)]">
                {seQuedan.map((t) => fila(t, false))}
              </div>
            </div>
          )}
        </div>
      )}
    </Hoja>
  );
}

/**
 * Mandar algo a la papelera.
 *
 * Una sola pregunta, no tres botones: el sistema ya sabe si tiene historia, y
 * eso decide solo si se va a borrar a los 30 días o si se queda. No hace falta
 * que lo decida una persona antes de saberlo.
 */
export function useDescartar() {
  const { descartar, avisar } = useStore();
  const confirmar = useConfirmar();

  return async (tipo: Descarte, id: string, nombre: string, enUso: number) => {
    const ok = await confirmar({
      titulo: `¿Mandar "${nombre}" a la papelera?`,
      detalle: enUso > 0
        ? `La usan ${enUso} ${enUso === 1 ? 'cosa' : 'cosas'}, así que se queda `
          + 'guardada en la papelera y no se borra: su historia no se pierde. '
          + 'Sale de los selectores y se restaura cuando quieras.'
        : 'No la usa nada. Se puede restaurar de un toque, y si no la sacas de '
          + 'ahí se borra sola a los 30 días.',
      confirmar: 'A la papelera',
      cancelar: 'Dejarla',
      destructivo: true,
    });
    if (!ok) return;

    try {
      await descartar(tipo, id);
      avisar('A la papelera. Se puede restaurar.', 'ok');
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo');
    }
  };
}

// --- categorias -----------------------------------------------------------

/**
 * Las economias: la casa y los negocios.
 *
 * Un solo libro con varios dueños del dinero. Lo que decide de quien es cada
 * movimiento no se elige aca sino en la categoria: aca solo se define que
 * economias existen.
 */
function HojaEntidades({ abierta, alCerrar }: { abierta: boolean; alCerrar: () => void }) {
  const { entities, categories } = useStore();
  const descartar = useDescartar();
  const [editando, setEditando] = useState<Entity | null>(null);

  const visibles = entities.filter((e) => !e.archived);

  return (
    <>
      <Hoja abierta={abierta && !editando} alCerrar={alCerrar} titulo="Economías">
        <div className="space-y-5">
          <Boton onClick={() => setEditando({
            id: '', householdId: '', name: '', kind: 'negocio', color: '#9a6a06',
            icon: 'briefcase', displayOrder: visibles.length, archived: false,
            trashedAt: null, trashedBy: null, createdAt: 0,
          })} className="w-full">
            <Icono nombre="plus" size={17} /> Nueva economía
          </Boton>

          <div className="space-y-1">
            {visibles.map((e) => (
              <div key={e.id} className="flex items-center gap-3 py-2">
                <Ficha color={e.color} icono={e.icon} size={38} />
                <button onClick={() => setEditando(e)} className="flex-1 min-w-0 text-left">
                  <p className="t-fila font-medium txt truncate">{e.name}</p>
                  <p className="t-nota txt-3">
                    {e.kind === 'negocio' ? 'Negocio' : 'Personal'}
                    {' · '}
                    {categories.filter((c) => c.entityId === e.id && !c.archived).length} categorías
                  </p>
                </button>
                {visibles.length > 1 && (
                  <button
                    onClick={() => void descartar(
                      'economia', e.id, e.name,
                      categories.filter((c) => c.entityId === e.id).length,
                    )}
                    aria-label={`Tirar ${e.name} a la papelera`}
                    className="w-9 h-9 rounded-lg flex items-center justify-center txt-3 shrink-0"
                  >
                    <Icono nombre="trash-2" size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </Hoja>

      <EditorEntidad entidad={editando} alCerrar={() => setEditando(null)} />
    </>
  );
}

function EditorEntidad({ entidad, alCerrar }: { entidad: Entity | null; alCerrar: () => void }) {
  const { guardarEntidad, avisar } = useStore();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'personal' | 'negocio'>('negocio');
  const [icon, setIcon] = useState('briefcase');
  const [color, setColor] = useState('#9a6a06');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!entidad) return;
    setName(entidad.name);
    setKind(entidad.kind);
    setIcon(entidad.icon);
    setColor(entidad.color);
  }, [entidad]);

  if (!entidad) return null;
  const esNueva = entidad.id === '';

  return (
    <Hoja abierta alCerrar={alCerrar} titulo={esNueva ? 'Nueva economía' : 'Editar economía'}>
      <div className="space-y-5">
        <div className="flex flex-col items-center pt-1">
          <Ficha color={color} icono={icon} size={64} />
          <p className="t-fila font-medium txt mt-2">{name || 'Sin nombre'}</p>
        </div>

        <Campo
          etiqueta="Nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="PanaClaw, BukoFlow..."
        />

        <div className="grid grid-cols-2 gap-2">
          {([['personal', 'Personal'], ['negocio', 'Negocio']] as const).map(([k, etiqueta]) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn(
                'min-h-11 rounded-xl t-fila font-medium border transition-all',
                kind === k ? 'bg-marca-600 text-white border-transparent' : 'superficie-2 borde txt-2',
              )}
            >
              {etiqueta}
            </button>
          ))}
        </div>

        <div>
          <span className="block t-nota font-medium txt-2 mb-2">Color</span>
          <SelectorColor valor={color} alElegir={setColor} />
        </div>

        <div>
          <span className="block t-nota font-medium txt-2 mb-2">Ícono</span>
          <SelectorIcono valor={icon} alElegir={setIcon} color={color} />
        </div>

        <Boton
          onClick={async () => {
            if (!name.trim()) return;
            setGuardando(true);
            try {
              await guardarEntidad(
                { name: name.trim(), kind, icon, color },
                esNueva ? undefined : entidad.id,
              );
              alCerrar();
            } catch (e) {
              avisar(e instanceof Error ? e.message : 'No se pudo guardar');
            } finally {
              setGuardando(false);
            }
          }}
          disabled={!name.trim() || guardando}
          className="w-full min-h-12"
        >
          {guardando ? 'Guardando...' : 'Guardar'}
        </Boton>
      </div>
    </Hoja>
  );
}

function HojaCategorias({ abierta, alCerrar }: { abierta: boolean; alCerrar: () => void }) {
  const { categories, entities, entidadActiva, transactions, budgets, recurring } = useStore();
  const descartar = useDescartar();
  const [editando, setEditando] = useState<Category | null>(null);

  // Cuantas cosas la usan, para que el diálogo diga si se puede borrar o no.
  const cuantoLaUsan = (id: string) =>
    transactions.filter((t) => t.categoryId === id).length
    + budgets.filter((b) => b.categoryId === id).length
    + recurring.filter((r) => r.categoryId === id).length;

  // Una categoria nueva nace en la entidad que se esta mirando. Si estan en
  // el consolidado, en la primera, que es Familia.
  const entidadPorDefecto = entidadActiva ?? entities.find((e) => !e.archived)?.id ?? null;

  const visibles = categories.filter((c) => !c.archived);
  const gastos = visibles.filter((c) => c.type === 'gasto');
  const ingresos = visibles.filter((c) => c.type === 'ingreso');

  // Con mas de una economia, la lista se agrupa por dueño. Sin esto habia que
  // abrir las 30 categorias de a una para saber cual era de quien, que es
  // justo lo que hay que hacer despues de crear un negocio.
  const economias = entities.filter((e) => !e.archived);
  const agrupar = (lista: Category[]) => {
    if (economias.length < 2) return [{ economia: null as Entity | null, lista }];
    const grupos = economias
      .map((economia) => ({ economia, lista: lista.filter((c) => c.entityId === economia.id) }))
      .filter((g) => g.lista.length > 0);
    const sueltas = lista.filter((c) => !economias.some((e) => e.id === c.entityId));
    // Las sin dueño van primero: son las que hay que arreglar.
    return sueltas.length > 0
      ? [{ economia: null as Entity | null, lista: sueltas }, ...grupos]
      : grupos;
  };

  return (
    <>
      <Hoja abierta={abierta && !editando} alCerrar={alCerrar} titulo="Categorías">
        <div className="space-y-5">
          <Boton onClick={() => setEditando({
            id: '', householdId: '', name: '', type: 'gasto', parentId: null,
            icon: 'tag', color: '#64748b', archived: false, trashedAt: null,
            trashedBy: null, displayOrder: 0, createdAt: 0, entityId: entidadPorDefecto,
          })} className="w-full">
            <Icono nombre="plus" size={17} /> Nueva categoría
          </Boton>

          {economias.length > 1 && (
            <span />
          )}

          {[
            { titulo: 'Gastos', lista: gastos },
            { titulo: 'Ingresos', lista: ingresos },
          ].map(({ titulo, lista }) => lista.length > 0 && (
            <div key={titulo}>
              <p className="t-nota font-medium txt-3 mb-2">{titulo}</p>
              {agrupar(lista).map(({ economia, lista: suyas }) => (
              <div key={economia?.id ?? 'sueltas'} className="mb-3 last:mb-0">
                {economias.length > 1 && (
                  <p className="t-nota font-semibold uppercase tracking-wide mb-1.5"
                    style={{ color: economia?.color ?? '#ef4444' }}>
                    {economia?.name ?? 'Sin economía'}
                  </p>
                )}
              <div className="space-y-1.5">
                {suyas.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 py-1">
                    <Ficha color={c.color} icono={c.icon} size={34} />
                    <button onClick={() => setEditando(c)} className="flex-1 min-w-0 text-left">
                      <span className="t-fila txt truncate block">{c.name}</span>
                    </button>
                    <button
                      onClick={() => setEditando(c)}
                      aria-label={`Editar ${c.name}`}
                      className="w-9 h-9 rounded-lg flex items-center justify-center txt-3 shrink-0"
                    >
                      <Icono nombre="pencil" size={15} />
                    </button>
                    <button
                      onClick={() => void descartar('categoria', c.id, c.name, cuantoLaUsan(c.id))}
                      aria-label={`Tirar ${c.name} a la papelera`}
                      className="w-9 h-9 rounded-lg flex items-center justify-center txt-3 shrink-0"
                    >
                      <Icono nombre="trash-2" size={15} />
                    </button>
                  </div>
                ))}
              </div>
              </div>
              ))}
            </div>
          ))}
        </div>
      </Hoja>

      <EditorCategoria categoria={editando} alCerrar={() => setEditando(null)} />
    </>
  );
}

function EditorCategoria({ categoria, alCerrar }: {
  categoria: Category | null; alCerrar: () => void;
}) {
  const { entities, transactions, guardarCategoria, avisar } = useStore();
  const [name, setName] = useState('');
  const [tipo, setTipo] = useState<'ingreso' | 'gasto'>('gasto');
  const [icon, setIcon] = useState('tag');
  const [color, setColor] = useState('#64748b');
  const [entityId, setEntityId] = useState<string>('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!categoria) return;
    setName(categoria.name);
    setTipo(categoria.type);
    setIcon(categoria.icon);
    setColor(categoria.color);
    setEntityId(categoria.entityId ?? '');
  }, [categoria]);

  const visibles = entities.filter((e) => !e.archived);
  // Cuantos movimientos se van a reclasificar de una: es la informacion que
  // hace que valga la pena tener la entidad aca y no en cada movimiento.
  const cuantos = categoria
    ? transactions.filter((t) => t.categoryId === categoria.id && !t.entityId).length
    : 0;
  const cambiaDeEntidad = categoria !== null && (categoria.entityId ?? '') !== entityId;

  if (!categoria) return null;
  const esNueva = categoria.id === '';

  return (
    <Hoja abierta alCerrar={alCerrar} titulo={esNueva ? 'Nueva categoría' : 'Editar categoría'}>
      <div className="space-y-5">
        <div className="flex flex-col items-center pt-1">
          <Ficha color={color} icono={icon} size={64} />
          <p className="t-fila font-medium txt mt-2">{name || 'Sin nombre'}</p>
        </div>

        <Campo etiqueta="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Comida, Transporte..." />

        {/* El tipo solo se elige al crear: cambiarlo despues dejaria
            movimientos de gasto colgados de una categoria de ingreso. */}
        {esNueva && (
          <div className="grid grid-cols-2 gap-2">
            {(['gasto', 'ingreso'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTipo(t)}
                className={cn(
                  'min-h-11 rounded-xl t-fila font-medium border transition-all capitalize',
                  tipo === t ? 'bg-marca-600 text-white border-transparent' : 'superficie-2 borde txt-2',
                )}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {visibles.length > 1 && (
          <>
            <Selector
              etiqueta="De quién es"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              <option value="">Sin clasificar</option>
              {visibles.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Selector>
            {cambiaDeEntidad && cuantos > 0 && (
              <p className="t-nota txt-3 px-1 -mt-2 leading-relaxed">
                {cuantos === 1
                  ? 'El movimiento que usa esta categoría pasa también.'
                  : `Los ${cuantos} movimientos que usan esta categoría pasan también.`}
                {' '}No se reescribe ninguno: la entidad se lee desde acá.
              </p>
            )}
          </>
        )}

        <div>
          <span className="block t-nota font-medium txt-2 mb-2">Color</span>
          <SelectorColor valor={color} alElegir={setColor} />
        </div>

        <div>
          <span className="block t-nota font-medium txt-2 mb-2">Ícono</span>
          <SelectorIcono valor={icon} alElegir={setIcon} color={color} />
        </div>

        <Boton
          onClick={async () => {
            if (!name.trim()) return;
            setGuardando(true);
            try {
              await guardarCategoria(
                { name: name.trim(), type: tipo, icon, color, entityId: entityId || null },
                esNueva ? undefined : categoria.id,
              );
              alCerrar();
            } catch (e) {
              avisar(e instanceof Error ? e.message : 'No se pudo guardar');
            } finally {
              setGuardando(false);
            }
          }}
          disabled={!name.trim() || guardando}
          className="w-full min-h-12"
        >
          {guardando ? 'Guardando...' : 'Guardar'}
        </Boton>
      </div>
    </Hoja>
  );
}

// --- presupuestos ---------------------------------------------------------

/**
 * La lista de topes del mes. Vive en una hoja y no suelta en Ajustes porque
 * con varios presupuestos empujaba todo lo demas fuera de la pantalla.
 */
function HojaPresupuestos({ abierta, alCerrar, alEditar }: {
  abierta: boolean; alCerrar: () => void; alEditar: (b: Budget | null) => void;
}) {
  const { budgets, transactions, entities, categories, papelera, household } = useStore();
  const moneda = household?.currency ?? 'USD';
  const variasEconomias = entities.length > 1;

  // Los de evento son los que tienen nombre. Los de mes y categoría siguen
  // existiendo y se muestran aparte, pero no se crean más: un tope mensual por
  // categoría que acumula es exactamente una jarra.
  const eventos = useMemo(
    () => budgets.filter(esEvento)
      .map((b) => ({
        b,
        gastado: gastadoEnEvento(b.id, transactions),
        economia: entities.find((e) => e.id === b.entityId),
      }))
      .sort((a, b) => (a.b.closedAt ? 1 : 0) - (b.b.closedAt ? 1 : 0)
        || b.b.createdAt - a.b.createdAt),
    [budgets, transactions, entities],
  );

  const viejos = useMemo(() => budgets
    .filter((b) => !esEvento(b))
    .map((b) => {
      const cat = categories.find((c) => c.id === b.categoryId);
      /*
       * También se busca en la papelera, y esto no es un detalle.
       *
       * Un tope mensual impide borrar de verdad su categoría: es el motivo que
       * la papelera muestra como «1 tope mensual». Pero acá el tope se dibuja
       * con el nombre de SU categoría, y lo que está en la papelera no existe
       * para el resto de la app, así que el tope de una categoría tirada
       * aparecía como «Todo el mes» —idéntico a un tope global de verdad— y no
       * había forma de saber que ESE era el que trababa a la otra. Quedaban las
       * dos atascadas, cada una escondiendo a la otra.
       */
      const tirada = cat ? undefined : papelera.categories.find((c) => c.id === b.categoryId);
      return {
        b,
        cat: cat ?? tirada,
        enLaPapelera: tirada !== undefined,
        // Cada uno contra SU mes, no contra el actual: un tope de agosto se mide
        // con lo que se gastó en agosto.
        gastado: estadoPresupuestos([b], transactions, b.period, categories)[0]?.gastadoMinor ?? 0,
      };
    })
    .sort((a, x) => x.b.period.localeCompare(a.b.period)
      || (a.cat?.name ?? '').localeCompare(x.cat?.name ?? '')),
  [budgets, categories, papelera, transactions]);

  const fila = (
    clave: string,
    nombre: string,
    icono: string,
    color: string,
    gastado: number,
    tope: number,
    alTocar: () => void,
    apagado: boolean,
    aclaracion?: string,
  ) => {
    const ratio = tope > 0 ? gastado / tope : 0;
    const resto = tope - gastado;
    return (
      <button
        key={clave}
        onClick={alTocar}
        className={cn('w-full text-left flex items-center gap-3', apagado && 'opacity-55')}
      >
        <Ficha color={color} icono={icono} size={38} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="t-fila font-medium txt truncate">
              {nombre}
              {aclaracion && <span className="txt-3 font-normal"> · {aclaracion}</span>}
            </span>
            <span className={cn(
              't-nota tabular shrink-0',
              ratio > 1 ? 'text-red-500 font-semibold' : ratio > 0.8 ? 'text-amber-500' : 'txt-2',
            )}>
              {formatMonto(gastado, moneda)} / {formatMonto(tope, moneda)}
            </span>
          </div>
          <div className="mt-1.5">
            <Barra ratio={ratio} color={color} alerta />
          </div>
          <p className="t-nota txt-3 mt-1">
            {resto >= 0
              ? `Quedan ${formatMonto(resto, moneda)}`
              : `Te pasaste ${formatMonto(-resto, moneda)}`}
          </p>
        </div>
      </button>
    );
  };

  return (
    <Hoja
      abierta={abierta}
      alCerrar={alCerrar}
      titulo="Presupuestos"
      pie={(
        <Boton onClick={() => alEditar(null)} className="w-full min-h-12">
          <Icono nombre="plus" size={17} /> Nuevo presupuesto
        </Boton>
      )}
    >
      {eventos.length === 0 && viejos.length === 0 ? (
        <Vacio
          icono="scale"
          titulo="Sin presupuestos"
          texto="Un nombre y un tope, para algo puntual. Solo mide."
          accion={<Boton onClick={() => alEditar(null)}>Crear el primero</Boton>}
        />
      ) : (
        <div className="space-y-4">
          {eventos.map(({ b, gastado, economia }) => fila(
            b.id,
            b.name ?? '',
            b.icon ?? 'scale',
            economia?.color ?? '#10b981',
            gastado,
            b.amountMinor,
            () => alEditar(b),
            Boolean(b.closedAt),
            [b.closedAt ? 'cerrado' : null, economia && variasEconomias ? economia.name : null]
              .filter(Boolean).join(' · ') || undefined,
          ))}

          {viejos.map(({ b, cat, enLaPapelera, gastado }) => fila(
            b.id,
            cat?.name ?? 'Todo el mes',
            b.icon ?? cat?.icon ?? 'calendar-days',
            cat?.color ?? '#64748b',
            gastado,
            b.amountMinor,
            () => alEditar(b),
            enLaPapelera,
            [
              b.period,
              // Lo dice acá porque es la única pantalla donde se puede
              // resolver: borrando este tope, la categoría se deja borrar.
              enLaPapelera ? 'su categoría está en la papelera' : null,
            ].filter(Boolean).join(' · '),
          ))}
        </div>
      )}
    </Hoja>
  );
}

function HojaPresupuesto({ abierta, alCerrar, editando }: {
  abierta: boolean; alCerrar: () => void; editando: Budget | null;
}) {
  const {
    entities, categories, household, transactions, guardarPresupuesto,
    borrarPresupuesto, avisar,
  } = useStore();
  const confirmar = useConfirmar();
  const moneda = household?.currency ?? 'USD';

  // Un tope mensual de los viejos no tiene nombre: lo identifica su categoría
  // y su mes, y de esos dos no se toca ninguno. Lo único que se corrige es
  // cuánto. Antes no se podía ni eso, y era la lista que más se mira.
  const esTopeViejo = Boolean(editando) && !esEvento(editando as Budget);
  const catDelTope = categories.find((c) => c.id === editando?.categoryId);

  const [nombre, setNombre] = useState('');
  const [monto, setMonto] = useState('');
  const [economia, setEconomia] = useState('');
  const [icono, setIcono] = useState('scale');
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!abierta) return;
    setNombre(editando?.name ?? '');
    setMonto(editando ? montoPlano(editando.amountMinor, moneda) : '');
    setEconomia(editando?.entityId ?? '');
    setIcono(editando?.icon ?? 'scale');
  }, [abierta, editando, moneda]);

  const economias = entities;
  const montoMinor = parseMonto(monto, moneda);
  const gastado = editando && !esTopeViejo ? gastadoEnEvento(editando.id, transactions) : 0;
  const cerrado = Boolean(editando?.closedAt);
  const puedeGuardar = montoMinor !== null && montoMinor >= 0 && !cargando
    && (esTopeViejo || nombre.trim().length > 0);

  async function eliminar() {
    if (!editando) return;
    const cuantos = transactions.filter((t) => t.budgetId === editando.id).length;
    const ok = await confirmar({
      titulo: `¿Borrar "${editando.name ?? catDelTope?.name ?? 'este presupuesto'}"?`,
      detalle: cuantos > 0
        ? `Los ${cuantos} gastos que le cargaron se quedan donde están.`
        : 'Nada más se toca.',
      destructivo: true,
    });
    if (ok !== true) return;
    try {
      await borrarPresupuesto(editando.id);
      alCerrar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo borrar');
    }
  }

  async function guardar(cerrarlo?: boolean) {
    if (!puedeGuardar || montoMinor === null) return;
    setCargando(true);
    try {
      await guardarPresupuesto(esTopeViejo
        // Sin `period` el Worker entiende que es una corrección de monto y no
        // mueve ni el mes ni la categoría, que son su identidad.
        ? { id: editando!.id, amountMinor: montoMinor }
        : {
          id: editando?.id,
          name: nombre.trim(),
          amountMinor: montoMinor,
          entityId: economia || null,
          icon: icono,
          closedAt: cerrarlo === undefined ? undefined : (cerrarlo ? Date.now() : null),
        });
      alCerrar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setCargando(false);
    }
  }

  return (
    <Hoja
      abierta={abierta}
      alCerrar={alCerrar}
      titulo={editando ? 'Editar presupuesto' : 'Nuevo presupuesto'}
      pie={(
        <div className="flex gap-2">
          {editando && (
            <Boton variante="peligro" onClick={() => void eliminar()} className="px-4" aria-label="Borrar">
              <Icono nombre="trash-2" size={17} />
            </Boton>
          )}
          <Boton
            onClick={() => void guardar()}
            disabled={!puedeGuardar}
            className="flex-1 min-h-12"
          >
            {cargando ? 'Guardando...' : 'Guardar'}
          </Boton>
        </div>
      )}
    >
      <div className="space-y-4">
        {esTopeViejo ? (
          <div className="flex items-center gap-3">
            <Ficha
              color={catDelTope?.color ?? '#64748b'}
              icono={catDelTope?.icon ?? 'calendar-days'}
              size={40}
            />
            <p className="t-fila font-medium txt">{catDelTope?.name ?? 'Todo el mes'}</p>
          </div>
        ) : (
          <>
            <Campo
              etiqueta="Nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Viaje a Cancún, Navidad, Mudanza..."
            />

            <div>
              <span className="block t-nota font-medium txt-2 mb-2">Ícono</span>
              <SelectorIcono
                valor={icono}
                alElegir={setIcono}
                color={entities.find((e) => e.id === economia)?.color ?? '#10b981'}
              />
            </div>
          </>
        )}

        <Campo
          etiqueta="Tope"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
        />

        {!esTopeViejo && economias.length > 1 && (
          <Selector
            etiqueta="¿De alguna economía?"
            value={economia}
            onChange={(e) => setEconomia(e.target.value)}
          >
            <option value="">De la casa, sin economía</option>
            {economias.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </Selector>
        )}

        {editando && !esTopeViejo && (
          <div className="superficie-2 rounded-2xl p-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="t-nota txt-2">Lleva gastado</span>
              <span className="t-fila font-semibold tabular txt">
                {formatMonto(gastado, moneda)}
              </span>
            </div>
            <Boton
              variante="secundario"
              onClick={() => void guardar(!cerrado)}
              disabled={cargando}
              className="w-full"
            >
              {cerrado ? 'Volver a abrirlo' : 'Darlo por cerrado'}
            </Boton>
          </div>
        )}
      </div>
    </Hoja>
  );
}

// --- invitar y contraseña -------------------------------------------------

function HojaInvitar({ abierta, alCerrar }: { abierta: boolean; alCerrar: () => void }) {
  const { invitar, avisar } = useStore();
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [pass, setPass] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Hoja abierta={abierta} alCerrar={alCerrar} titulo="Sumar a tu pareja">
      <div className="space-y-4">
        <p className="t-fila txt-2 leading-relaxed">
          Le creas la cuenta tú y le pasas los datos. Va a ver exactamente lo
          mismo que tú, en tiempo real. Que cambie la contraseña apenas entre.
        </p>
        <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Cómo se llama" />
        <Campo etiqueta="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="su@email.com" autoComplete="off" />
        <Campo etiqueta="Contraseña" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
        {error && <p className="t-fila text-red-500">{error}</p>}
        <Boton
          onClick={async () => {
            setCargando(true); setError(null);
            try {
              await invitar({ email, password: pass, displayName: nombre });
              avisar(`${nombre} ya puede entrar con ese email y contraseña`, 'ok');
              setEmail(''); setNombre(''); setPass('');
              alCerrar();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'No se pudo crear');
            } finally {
              setCargando(false);
            }
          }}
          disabled={!email || !nombre || pass.length < MIN_PASSWORD || cargando}
          className="w-full min-h-12"
        >
          {cargando ? 'Creando...' : 'Crear su cuenta'}
        </Boton>
      </div>
    </Hoja>
  );
}

function HojaPassword({ abierta, alCerrar }: { abierta: boolean; alCerrar: () => void }) {
  const { avisar, me } = useStore();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Hoja abierta={abierta} alCerrar={alCerrar} titulo="Cambiar contraseña">
      <div className="space-y-4">
        <Campo etiqueta="Contraseña actual" type="password" value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" />
        <Campo etiqueta="Nueva contraseña" type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
        <p className="t-nota txt-3">Al cambiarla se cierran las sesiones abiertas en otros dispositivos.</p>
        {error && <p className="t-fila text-red-500">{error}</p>}
        <Boton
          onClick={async () => {
            setCargando(true); setError(null);
            try {
              await api.cambiarPassword(me?.email ?? '', actual, nueva);
              avisar('Contraseña actualizada', 'ok');
              setActual(''); setNueva('');
              alCerrar();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'No se pudo cambiar');
            } finally {
              setCargando(false);
            }
          }}
          disabled={!actual || nueva.length < MIN_PASSWORD || cargando}
          className="w-full min-h-12"
        >
          {cargando ? 'Guardando...' : 'Cambiar'}
        </Boton>
      </div>
    </Hoja>
  );
}

// --- exportar -------------------------------------------------------------

function exportarCsv(
  transactions: { id: string; type: TxType; amountMinor: number; description: string; date: number; categoryId: string | null; accountId: string; createdBy: string; paidBy: string | null; notes: string | null }[],
  categories: { id: string; name: string }[],
  accounts: { id: string; name: string }[],
  members: { id: string; displayName: string }[],
  moneda: string,
): void {
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const mem = new Map(members.map((m) => [m.id, m.displayName]));
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;

  const filas = [
    ['Fecha', 'Tipo', 'Descripcion', 'Monto', 'Moneda', 'Categoria', 'Cuenta', 'Lo hizo', 'Lo cargo', 'Notas'].join(','),
    ...transactions.map((t) => [
      new Date(t.date).toISOString().slice(0, 10),
      esc(TX_TYPE_LABEL[t.type] ?? ''),
      esc(t.description),
      montoPlano(t.amountMinor, moneda),
      moneda,
      esc(cat.get(t.categoryId ?? '') ?? ''),
      esc(acc.get(t.accountId) ?? ''),
      esc(mem.get(t.paidBy ?? t.createdBy) ?? ''),
      esc(mem.get(t.createdBy) ?? ''),
      esc(t.notes ?? ''),
    ].join(',')),
  ].join('\n');

  try {
    const blob = new Blob(['﻿' + filas], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gastos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    // Sin descarga disponible; no hay mucho que hacer.
  }
}
