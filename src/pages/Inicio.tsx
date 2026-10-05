/**
 * Pantalla principal.
 *
 * Las secciones se dibujan en el orden que cada persona eligio en Ajustes, y
 * las que saco no se dibujan. El orden vive en el perfil (member.homeLayout),
 * asi que viaja con la cuenta y no con el telefono.
 */

import { useMemo, useState } from 'react';
import { useStore } from '../store/store.tsx';
import { formatMonto } from '@shared/money';
import {
  autorDe, calcularPatrimonio, claveMes, estadoPresupuestos, filtrarPorEntidad,
  porCategoria, porPersona, resumir,
} from '@shared/domain';
import { dentroDe, periodoMes, type Periodo } from '@shared/periodo';
import {
  SECCIONES_INICIO, TxType, type Recurring, type SeccionInicio, type Transaction,
} from '@shared/types';
import { describirRegla } from '@shared/recurrencia';
import { fechaCorta } from '../lib/utils.ts';
import {
  Avatar, Barra, Boton, Deslizable, Ficha, Icono, Tarjeta, Vacio,
} from '../components/ui/base.tsx';
import { useConfirmar } from '../components/ui/confirmar.tsx';
import { EtiquetaEntidad } from '../components/ui/entidad.tsx';
import { SelectorPeriodo } from '../components/ui/periodo.tsx';
import { cn } from '../lib/utils.ts';

export function Inicio({ alVerMovimiento, alEditarMovimiento, alAgregar }: {
  alVerMovimiento: (tx: Transaction) => void;
  alEditarMovimiento: (tx: Transaction) => void;
  alAgregar: () => void;
}) {
  const {
    accounts, categories, categoriasTodas, transactions: todos, budgets, members, me,
    household, recurring: todosLosHabituales, entities, entidadActiva,
  } = useStore();
  const moneda = household?.currency ?? 'USD';

  // El mismo selector que Movimientos y Jarras: dia, semana, mes, año o rango
  // libre. Arranca en el mes, que es como se miraba antes.
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoMes(Date.now()));

  // Los presupuestos son mensuales por definicion, asi que no siguen al rango:
  // siguen al mes donde cae. Si no, un rango de dos semanas mostraria el tope
  // entero contra medio mes de gastos, que es peor que no mostrarlo.
  const mes = claveMes(Math.min(periodo.hasta, Date.now()));

  // TODO lo de esta pantalla sale de aca, asi que el selector de arriba manda
  // sobre el balance, el gasto por categoria, quien gasto y los presupuestos.
  // En "Todo" no filtra nada y se ve la vida entera.
  // Con TODAS las categorías: saber de qué economía es un movimiento ya
  // guardado no es ofrecer nada, y con la lista recortada los movimientos de
  // una categoría tirada se caían de la pantalla al elegir una economía.
  const transactions = useMemo(
    () => filtrarPorEntidad(todos, categoriasTodas, entidadActiva),
    [todos, categoriasTodas, entidadActiva],
  );

  const delMes = useMemo(
    () => transactions.filter((t) => dentroDe(t.date, periodo)),
    [transactions, periodo],
  );
  const resumen = useMemo(() => resumir(delMes), [delMes]);
  // El patrimonio es la excepcion: las cuentas estan mezcladas, no hay una que
  // sea de un negocio. Filtrarlo seria inventar un numero que no existe.
  const patrimonio = useMemo(() => calcularPatrimonio(accounts), [accounts]);
  const porPers = useMemo(() => porPersona(delMes, members), [delMes, members]);
  const gastoPorCat = useMemo(() => porCategoria(delMes, categories, 'gasto').slice(0, 5), [delMes, categories]);
  const presupuestos = useMemo(
    () => estadoPresupuestos(budgets, transactions, mes, categories),
    [budgets, transactions, mes, categories],
  );
  const ultimos = useMemo(() => delMes.slice(0, 6), [delMes]);

  // Los pagos habituales heredan la economia de su categoria, igual que un
  // movimiento.
  const recurring = useMemo(() => {
    if (entidadActiva === null) return todosLosHabituales;
    const porId = new Map(categories.map((c) => [c.id, c]));
    return todosLosHabituales.filter((r) => (
      (r.entityId ?? (r.categoryId ? porId.get(r.categoryId)?.entityId ?? null : null)) === entidadActiva
    ));
  }, [todosLosHabituales, categories, entidadActiva]);

  const proximos = useMemo(
    () => recurring.filter((r) => r.active).slice(0, 4), [recurring],
  );

  const nombreActiva = entities.find((e) => e.id === entidadActiva)?.name ?? '';

  // El orden guardado manda; si esta vacio, el de fabrica. Las secciones que
  // la persona saco simplemente no estan en la lista.
  const orden: SeccionInicio[] = me?.homeLayout?.length ? me.homeLayout : [...SECCIONES_INICIO];

  const secciones: Record<SeccionInicio, React.ReactNode> = {
    'resumen': (
      <Tarjeta>
        <div className="flex items-baseline justify-between gap-2 mb-3">
          {/* El mismo título que «En qué se fue» o «Quién gastó»: son todos el
              encabezado de una tarjeta del Inicio y no hay ninguna razón para
              que este se lea más chico y más claro que los otros. */}
          <h2 className="t-seccion font-semibold txt min-w-0 truncate">
            {periodo.tipo === 'mes' ? 'Balance del mes' : 'Balance del período'}
            {nombreActiva && ` · ${nombreActiva}`}
          </h2>
          <p className={cn(
            't-monto font-semibold tabular tracking-tight',
            resumen.flujoMinor < 0 ? 'text-red-500' : 'txt',
          )}>
            {formatMonto(resumen.flujoMinor, moneda)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="superficie-2 rounded-2xl p-3">
            <div className="flex items-center gap-1.5 t-nota txt-3 mb-0.5">
              <Icono nombre="arrow-up-right" size={13} /> Entró
            </div>
            <p className="t-seccion font-semibold tabular txt">{formatMonto(resumen.ingresoMinor, moneda)}</p>
          </div>
          <div className="superficie-2 rounded-2xl p-3">
            <div className="flex items-center gap-1.5 t-nota txt-3 mb-0.5">
              <Icono nombre="arrow-down-left" size={13} /> Salió
            </div>
            <p className="t-seccion font-semibold tabular txt">{formatMonto(resumen.gastoMinor, moneda)}</p>
          </div>
        </div>
      </Tarjeta>
    ),

    'patrimonio': (
      <HeroPatrimonio
        montoMinor={patrimonio}
        moneda={moneda}
        /* Solo cuando hace falta: las cuentas estan mezcladas, no hay una que
           sea de un negocio, y sin decirlo este numero se leeria como si
           fuera de la economia que se esta mirando. */
        pie={nombreActiva ? 'Todas las economías juntas' : undefined}
      />
    ),

    'quien-gasto': members.length > 1 && resumen.gastoMinor > 0 ? (
      <Tarjeta>
        <h2 className="t-seccion font-semibold txt mb-3.5">Quién gastó</h2>
        <div className="space-y-3">
          {porPers.map(({ member, resumen: r }) => (
            <div key={member.id} className="flex items-center gap-3">
              <Avatar nombre={member.displayName} color={member.color} emoji={member.emoji} foto={member.photo} size={36} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="t-fila font-medium txt truncate">
                    {member.displayName}
                    {member.id === me?.id && <span className="txt-3 font-normal"> (tú)</span>}
                  </span>
                  <span className="t-fila font-semibold tabular txt shrink-0 ml-2">
                    {formatMonto(r.gastoMinor, moneda)}
                  </span>
                </div>
                <Barra
                  ratio={resumen.gastoMinor > 0 ? r.gastoMinor / resumen.gastoMinor : 0}
                  color={member.color}
                  fina
                />
              </div>
            </div>
          ))}
        </div>
      </Tarjeta>
    ) : null,

    'presupuestos': presupuestos.length > 0 ? (
      <Tarjeta>
        <h2 className="t-seccion font-semibold txt mb-3.5">Presupuestos</h2>
        <div className="space-y-3.5">
          {presupuestos.map(({ budget, gastadoMinor, ratio }) => {
            const cat = categories.find((c) => c.id === budget.categoryId);
            return (
              <div key={budget.id}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="t-fila font-medium txt">{cat?.name ?? 'Todo el mes'}</span>
                  <span className={cn(
                    't-nota tabular',
                    ratio > 1 ? 'text-red-500 font-semibold' : ratio > 0.8 ? 'text-amber-500' : 'txt-2',
                  )}>
                    {formatMonto(gastadoMinor, moneda, { compacto: true })} / {formatMonto(budget.amountMinor, moneda, { compacto: true })}
                  </span>
                </div>
                <Barra ratio={ratio} color={cat?.color ?? '#10b981'} alerta fina />
              </div>
            );
          })}
        </div>
      </Tarjeta>
    ) : null,

    'por-categoria': gastoPorCat.length > 0 ? (
      <Tarjeta>
        <h2 className="t-seccion font-semibold txt mb-3.5">En qué se fue</h2>
        <div className="space-y-3">
          {gastoPorCat.map(({ category, totalMinor }) => (
            <div key={category?.id ?? 'sin'} className="flex items-center gap-3">
              <Ficha color={category?.color ?? '#64748b'} icono={category?.icon ?? 'circle-help'} size={36} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="t-fila font-medium txt truncate">{category?.name ?? 'Sin categoría'}</span>
                  <span className="t-fila tabular txt shrink-0 ml-2">{formatMonto(totalMinor, moneda)}</span>
                </div>
                <Barra
                  ratio={resumen.gastoMinor > 0 ? totalMinor / resumen.gastoMinor : 0}
                  color={category?.color ?? '#64748b'}
                  fina
                />
              </div>
            </div>
          ))}
        </div>
      </Tarjeta>
    ) : null,

    'pagos-habituales': proximos.length > 0 ? (
      <Tarjeta className="py-3">
        <h2 className="t-seccion font-semibold txt px-1 mb-2">Pagos habituales</h2>
        <div className="divide-y divide-[var(--borde)] -mx-1">
          {proximos.map((r) => (
            <FilaHabitual key={r.id} recurrente={r} />
          ))}
        </div>
      </Tarjeta>
    ) : null,

    'ultimos': (
      <Tarjeta>
        <h2 className="t-seccion font-semibold txt mb-3.5">Últimos movimientos</h2>
        {ultimos.length === 0 ? (
          transactions.length === 0 ? (
            <Vacio
              icono="receipt-text"
              titulo="Todavía no hay nada"
              texto="Registra tu primer movimiento y va a aparecer acá, también en el teléfono de tu pareja."
              accion={<Boton onClick={alAgregar}>Registrar el primero</Boton>}
            />
          ) : (
            // No es que no haya nada: no hay nada en este rango. Decir lo
            // contrario haria dudar de si se perdio la plata.
            <Vacio
              icono="search-x"
              titulo="Nada en este período"
              texto="Muévete de período con el selector de arriba para ver otros movimientos."
            />
          )
        ) : (
          <div className="divide-y divide-[var(--borde)] -mx-1">
            {ultimos.map((tx) => (
              <FilaMovimiento
                key={tx.id}
                tx={tx}
                alTocar={() => alVerMovimiento(tx)}
                alEditar={alEditarMovimiento}
              />
            ))}
          </div>
        )}
      </Tarjeta>
    ),
  };

  return (
    <div className="space-y-4">
      <SelectorPeriodo periodo={periodo} alCambiar={setPeriodo} />

      {orden.map((id) => secciones[id] && <div key={id}>{secciones[id]}</div>)}

    </div>
  );
}

/** Una fila de la lista de movimientos. Se reusa en varias pantallas. */
/**
 * El patrimonio en grande. Lo unico que se pinta de color en toda la app.
 *
 * Vive aca y se exporta porque Cuentas muestra el mismo numero: dos copias del
 * mismo bloque terminan divergiendo en el primer retoque, y entonces la misma
 * plata se ve distinta en dos pantallas.
 */
export function HeroPatrimonio({ montoMinor, moneda, pie, extra, accion, alineacion = 'centrado' }: {
  montoMinor: number;
  moneda: string;
  /** Solo si hay algo que aclarar. Contar las cuentas no lo era. */
  pie?: string;
  /** Lo que va debajo del pie, si la pantalla tiene algo mas que decir. */
  extra?: React.ReactNode;
  /**
   * Un boton en la esquina de arriba.
   *
   * Vive aca y no en una fila propia: un titulo con un boton al lado se comia
   * un renglon entero para decir el nombre de la pantalla, que ya lo dice el
   * icono encendido de la barra de abajo.
   */
  accion?: React.ReactNode;
  /**
   * Como se planta el numero.
   *
   * `centrado` es el del Inicio: el patrimonio solo, en el medio, sin nada al
   * lado que lo desequilibre.
   *
   * `izquierda` es el de Cuentas, donde la tarjeta ademas lleva el boton de
   * «Cuenta». Ahi centrar era una ilusion: el numero se veia corrido porque
   * el boton flotaba encima de su mitad derecha. Alineados —el numero a la
   * izquierda, el boton a la derecha— cada uno tiene su lado y ninguno pisa
   * al otro.
   */
  alineacion?: 'centrado' | 'izquierda';
}) {
  const izquierda = alineacion === 'izquierda';

  return (
    <Tarjeta className="bg-linear-to-br from-marca-600 to-marca-700 border-transparent text-white">
      <div className={cn(
        izquierda ? 'flex items-start justify-between gap-3' : 'relative text-center',
      )}>
        {/* Centrado, el botón flota arriba a la derecha para que el número
            quede centrado de verdad: en una fila de dos columnas el texto se
            corría a la izquierda por el ancho del botón. Alineado, en cambio,
            el botón ES la segunda columna. */}
        {accion && !izquierda && <div className="absolute right-0 -top-1">{accion}</div>}

        <div className={cn('min-w-0', izquierda && 'text-left')}>
          {/* Del mismo tamaño y grosor que los demás encabezados de tarjeta.
              La opacidad se queda: acá el fondo es verde y el blanco pleno lo
              pondría a competir con la cifra, que es lo que hay que leer. */}
          <h2 className="t-seccion font-semibold opacity-80 mb-1">Patrimonio</h2>
          <p className="t-cifra font-bold tabular tracking-tight">
            {formatMonto(montoMinor, moneda)}
          </p>
          {pie && <p className="t-nota opacity-70 mt-1.5">{pie}</p>}
        </div>

        {accion && izquierda && <div className="shrink-0 -mt-1">{accion}</div>}
      </div>
      {extra}
    </Tarjeta>
  );
}

export function FilaMovimiento({ tx, alTocar, alEditar, sinFecha, deltaMinor }: {
  tx: Transaction;
  alTocar: () => void;
  /**
   * Abrir el formulario con este movimiento cargado.
   *
   * Cuando viene, la fila se puede correr con el dedo y deja ver «Editar» y
   * «Borrar». Sin esto la fila no se desliza: adentro del detalle de una jarra
   * el gesto sobraria, porque ahi no se corrige nada.
   */
  alEditar?: (tx: Transaction) => void;
  /** En una lista ya agrupada por dia, la fecha esta en el titulo del grupo. */
  sinFecha?: boolean;
  /**
   * Lo que este movimiento le hizo a la jarra que se esta mirando.
   *
   * Dentro de una jarra el monto del movimiento no es el numero que importa:
   * un sueldo de $2.500 le puso $1.375 a Necesidades y el resto a otras cinco.
   * Antes se veian los dos, el total grande y la parte chiquita encimada en la
   * esquina, y no habia forma de saber cual era cual. Con esto manda la parte,
   * y el total pasa a ser el detalle.
   */
  deltaMinor?: number;
}) {
  const {
    categoriaPorId, accounts, members, household, enVuelo, recienLlegados, entities,
    entidadActiva, borrarTx, avisar,
  } = useStore();
  const moneda = household?.currency ?? 'USD';

  // Por id y no filtrando `categories`: un movimiento guardado con una
  // categoría que después tiraron a la papelera se seguía dibujando como «Sin
  // categoría», sin su color ni su icono, y entonces no había forma de ver
  // cuáles eran los movimientos que la papelera decía que la estaban usando.
  const cat = categoriaPorId(tx.categoryId);
  // En el consolidado cada movimiento dice de quien es. Dentro de una entidad
  // la etiqueta seria ruido: ya lo dice el selector de arriba.
  const entidad = entidadActiva === null && entities.length > 1
    ? entities.find((e) => e.id === (tx.entityId ?? cat?.entityId ?? null))
    : undefined;
  const cuenta = accounts.find((c) => c.id === tx.accountId);
  const quien = members.find((m) => m.id === autorDe(tx));
  const subiendo = enVuelo.has(tx.id);
  const confirmar = useConfirmar();
  // Acaba de cargarlo la otra persona, en este momento. Ver aparecer la fila
  // es la mitad de la gracia de estar los dos adentro a la vez.
  const recien = recienLlegados.has(tx.id);

  const esIngreso = tx.type === TxType.INGRESO;
  const esTransferencia = tx.type === TxType.TRANSFERENCIA;

  const color = esTransferencia ? '#3b82f6' : esIngreso ? '#10b981' : (cat?.color ?? '#64748b');
  const icono = esTransferencia ? 'arrow-left-right' : (cat?.icon ?? (esIngreso ? 'arrow-up-right' : 'arrow-down-left'));

  async function eliminar() {
    const ok = await confirmar({
      titulo: '¿Borrar este movimiento?',
      detalle: `"${tx.description}" por ${formatMonto(tx.amountMinor, moneda)}. Los saldos se recalculan solos.`,
      destructivo: true,
    });
    if (!ok) return;
    try {
      await borrarTx(tx.id);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo borrar');
    }
  }

  const fila = (
    <button
      onClick={alTocar}
      className={cn(
        'w-full flex items-center gap-3 py-3 px-1 text-left transition-opacity active:opacity-60',
        subiendo && 'opacity-50',
        recien && 'fila-nueva',
      )}
    >
      <Ficha color={color} icono={icono} size={40} />

      <div className="flex-1 min-w-0">
        <p className="t-fila font-medium txt truncate">
          {tx.description}
          {tx.recurringId && (
            <Icono nombre="repeat" size={11} className="inline-block ml-1.5 txt-3 align-middle" />
          )}
        </p>
        {entidad && (
          <span className="inline-block mt-0.5"><EtiquetaEntidad entidad={entidad} /></span>
        )}
        {/* La fecha se calla cuando el grupo ya la dice: repetirla en cada
            fila de un mismo dia es la misma palabra catorce veces. */}
        <p className="t-nota txt-3 truncate">
          {[
            sinFecha ? null : fechaCorta(tx.date),
            deltaMinor !== undefined && Math.abs(deltaMinor) !== tx.amountMinor
              ? `de ${formatMonto(tx.amountMinor, moneda)}`
              : cuenta?.name,
            quien?.displayName,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="text-right shrink-0 flex items-center gap-2">
        <p className={cn(
          't-fila font-semibold tabular',
          deltaMinor !== undefined
            ? (deltaMinor > 0 ? 'text-marca-600 dark:text-marca-500' : 'txt')
            : esIngreso ? 'text-marca-600 dark:text-marca-500' : esTransferencia ? 'txt-2' : 'txt',
        )}>
          {deltaMinor !== undefined
            ? `${deltaMinor > 0 ? '+' : '−'}${formatMonto(Math.abs(deltaMinor), moneda)}`
            : `${esTransferencia ? '' : esIngreso ? '+' : '−'}${formatMonto(tx.amountMinor, moneda)}`}
        </p>
        {quien && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: quien.color }}
            title={quien.displayName}
          />
        )}
      </div>
    </button>
  );

  if (!alEditar) return fila;

  return (
    <Deslizable
      acciones={[
        { etiqueta: 'Editar', icono: 'pencil', alTocar: () => alEditar(tx) },
        { etiqueta: 'Borrar', icono: 'trash-2', peligro: true, alTocar: () => void eliminar() },
      ]}
    >
      {fila}
    </Deslizable>
  );
}

/**
 * Un pago habitual, con el boton para confirmar o deshacer el cobro.
 *
 * La fecha teorica y la real casi nunca coinciden: a veces pagan el 14 aunque
 * el sueldo sea el 15, y a veces el 15 pasa y el jefe no pago. Hasta ahora la
 * app solo sabia la teorica, asi que el saldo mostraba plata que no estaba —o
 * escondia la que si—, y encima se repartia en las jarras.
 */
function FilaHabitual({ recurrente: r }: { recurrente: Recurring }) {
  const {
    categoriaPorId, transactions, household, cobrarRecurrente, deshacerCobro, avisar,
  } = useStore();
  const moneda = household?.currency ?? 'USD';
  const [ocupado, setOcupado] = useState(false);

  const cat = categoriaPorId(r.categoryId);
  const dias = Math.ceil((r.nextRun - Date.now()) / 86_400_000);

  // El ultimo movimiento que nacio de este pago habitual. Es lo que se
  // deshace, y su existencia es lo que dice si el ciclo ya se cobro.
  const ultimo = useMemo(
    () => transactions.filter((t) => t.recurringId === r.id)
      .sort((a, b) => b.date - a.date)[0],
    [transactions, r.id],
  );

  // Pendiente = el ciclo se dio por cobrado y se deshizo, o todavia no llego
  // la fecha. Cobrado = hay un movimiento de este ciclo sin deshacer.
  const esperando = r.esperandoDesde !== null;
  const cobrado = !esperando && ultimo !== undefined && r.lastRun !== null;
  const esIngreso = r.type === TxType.INGRESO;

  async function alternar() {
    setOcupado(true);
    try {
      if (cobrado) await deshacerCobro(r.id);
      else await cobrarRecurrente(r.id);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex items-center gap-3 py-3 px-1">
      <Ficha color={cat?.color ?? '#8b5cf6'} icono={cat?.icon ?? 'repeat'} size={38} />
      <div className="flex-1 min-w-0">
        <p className="t-fila font-medium txt truncate">{r.name}</p>
        <p className="t-nota txt-3 truncate">
          {esperando ? (
            <span className="text-amber-600 dark:text-amber-500">
              Se esperaba el {fechaCorta(r.esperandoDesde ?? 0)} · sin {esIngreso ? 'cobrar' : 'pagar'}
            </span>
          ) : cobrado ? (
            <span className="text-marca-700 dark:text-marca-500">
              {esIngreso ? 'Cobrado' : 'Pagado'} el {fechaCorta(ultimo.date)}
            </span>
          ) : (
            <>
              {describirRegla({
                frecuencia: r.frequency,
                diaDelMes: r.dayOfMonth ?? undefined,
                diaDeSemana: r.dayOfWeek ?? undefined,
                mesDelAnio: r.monthOfYear ?? undefined,
              })}
              {dias >= 0 && dias <= 7 && ` · ${dias === 0 ? 'hoy' : `en ${dias} día${dias > 1 ? 's' : ''}`}`}
            </>
          )}
        </p>
      </div>

      <p className="t-fila font-semibold tabular txt shrink-0">
        {formatMonto(r.amountMinor, moneda)}
      </p>

      {/* El check. Prendido = ya paso de verdad. Apagado = todavia no.
          Apagarlo borra el movimiento que la app habia creado sola. */}
      <button
        onClick={() => void alternar()}
        disabled={ocupado}
        aria-label={cobrado
          ? `Deshacer: todavía no ${esIngreso ? 'me pagaron' : 'lo pagué'}`
          : `Marcar que ya ${esIngreso ? 'me pagaron' : 'lo pagué'}`}
        className={cn(
          'w-9 h-9 rounded-full border flex items-center justify-center shrink-0 transition-all active:scale-90 disabled:opacity-40',
          cobrado
            ? 'bg-marca-600 border-transparent text-white'
            : esperando
              ? 'border-amber-500 text-amber-600 dark:text-amber-500'
              : 'superficie-2 borde txt-3',
        )}
      >
        <Icono nombre={cobrado ? 'check' : 'circle'} size={17} />
      </button>
    </div>
  );
}
