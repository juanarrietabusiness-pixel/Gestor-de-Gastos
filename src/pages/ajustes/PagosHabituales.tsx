/**
 * Pagos habituales: se crean y configuran aca, igual que los presupuestos.
 *
 * Es una hoja y no una tarjeta suelta en Ajustes: con media docena de pagos
 * la lista empujaba el resto de los ajustes fuera de la pantalla.
 *
 * El movimiento lo carga solo el disparador programado cuando llega la fecha.
 * Por eso el formulario insiste con la fecha del proximo cobro: es la unica
 * forma de que quien lo configura sepa que va a pasar y cuando.
 */

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/store.tsx';
import { formatMonto, montoPlano, parseMonto } from '@shared/money';
import { TxType, type Recurring } from '@shared/types';
import {
  DIAS_SEMANA, describirRegla, FRECUENCIA_LABEL, FRECUENCIAS, MESES,
  primeraFecha, QUINCENA_POR_DEFECTO, reglaDe, type Frecuencia,
} from '@shared/recurrencia';
import { Boton, Campo, Ficha, Hoja, Icono, Selector } from '../../components/ui/base.tsx';
import { OpcionesPorEconomia } from '../../components/ui/entidad.tsx';
import { useConfirmar } from '../../components/ui/confirmar.tsx';
import { cuentasPorDueno } from '../../components/transactions/CargaRapida.tsx';
import { cn } from '../../lib/utils.ts';

export function PagosHabituales({ abierta, alCerrar }: {
  abierta: boolean; alCerrar: () => void;
}) {
  const {
    recurring, categoriaPorId, accounts, household, borrarRecurrente, avisar,
  } = useStore();
  const confirmar = useConfirmar();
  const moneda = household?.currency ?? 'USD';

  const [editando, setEditando] = useState<Recurring | null>(null);
  const [abierto, setAbierto] = useState(false);

  async function eliminar(r: Recurring) {
    const ok = await confirmar({
      titulo: `¿Borrar "${r.name}"?`,
      detalle: 'Deja de cargarse automáticamente. Los movimientos que ya creó se quedan donde están.',
      destructivo: true,
    });
    if (!ok) return;
    try {
      await borrarRecurrente(r.id);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo borrar');
    }
  }

  return (
    <>
      <Hoja abierta={abierta && !abierto} alCerrar={alCerrar} titulo="Pagos habituales">
        <div className="space-y-5">
          <Boton onClick={() => { setEditando(null); setAbierto(true); }} className="w-full">
            <Icono nombre="plus" size={17} /> Nuevo pago habitual
          </Boton>

        {recurring.length === 0 ? (
          <p className="t-fila txt-3 leading-relaxed">
            El alquiler, la luz, Netflix. Se cargan solos el día que corresponde,
            así no hay que acordarse ni anotarlos a mano.
          </p>
        ) : (
          <div className="space-y-2">
            {recurring.map((r) => {
              // Incluida la que esté en la papelera: un pago habitual que apunta
              // a una categoría tirada es justamente lo que impide borrarla, así
              // que acá tiene que verse con su nombre y no en gris.
              const cat = categoriaPorId(r.categoryId);
              const cuenta = accounts.find((a) => a.id === r.accountId);
              const dias = Math.ceil((r.nextRun - Date.now()) / 86_400_000);

              return (
                <div key={r.id} className={cn('flex items-center gap-3', !r.active && 'opacity-50')}>
                  <Ficha color={cat?.color ?? '#8b5cf6'} icono={cat?.icon ?? 'repeat'} size={38} />
                  <button
                    onClick={() => { setEditando(r); setAbierto(true); }}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="t-fila font-medium txt truncate">
                      {r.name}
                      {!r.active && <span className="txt-3 font-normal"> · en pausa</span>}
                    </p>
                    <p className="t-nota txt-3 truncate">
                      {describirRegla(reglaDe(r))}
                      {cuenta && ` · ${cuenta.name}`}
                      {r.active && dias >= 0 && dias <= 31 &&
                        ` · ${dias === 0 ? 'hoy' : `en ${dias} día${dias > 1 ? 's' : ''}`}`}
                    </p>
                  </button>
                  <p className={cn(
                    't-fila font-semibold tabular shrink-0',
                    r.type === TxType.INGRESO ? 'text-marca-600 dark:text-marca-500' : 'txt',
                  )}>
                    {r.type === TxType.INGRESO ? '+' : '−'}{formatMonto(r.amountMinor, moneda, { compacto: true })}
                  </p>
                  <button
                    onClick={() => void eliminar(r)}
                    aria-label={`Borrar ${r.name}`}
                    className="w-9 h-9 rounded-lg flex items-center justify-center txt-3 shrink-0"
                  >
                    <Icono nombre="trash-2" size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </Hoja>

      <FormularioPago
        abierto={abierto}
        alCerrar={() => { setAbierto(false); setEditando(null); }}
        editando={editando}
      />
    </>
  );
}

const DIAS_DEL_MES = Array.from({ length: 31 }, (_, i) => i + 1);

/**
 * Un bloque del formulario.
 *
 * El formulario tenia catorce controles seguidos, todos con el mismo peso
 * visual, y con seis frecuencias los de fecha pasaron a ser hasta tres. Sin
 * nada que los agrupe hay que leerlos de arriba abajo para encontrar el que
 * se busca. Son tres preguntas distintas —que es, cuando cae, de donde sale—
 * y separarlas es lo que deja ver de un vistazo en cual estas.
 */
function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="t-nota font-semibold uppercase tracking-wide txt-3 px-1">{titulo}</h3>
      {children}
    </section>
  );
}

/**
 * El 31 se muestra como "ultimo dia" porque es lo que de verdad significa:
 * el calculo lo recorta al ultimo dia real de cada mes. Poner "31" a secas
 * haria dudar a cualquiera que cobre a fin de mes en febrero.
 */
const etiquetaDia = (d: number) => (d === 31 ? '31 · último día' : String(d));

function FormularioPago({ abierto, alCerrar, editando }: {
  abierto: boolean; alCerrar: () => void; editando: Recurring | null;
}) {
  const {
    accounts, categories, jars, entities, members, household, guardarRecurrente, avisar,
  } = useStore();
  const moneda = household?.currency ?? 'USD';
  const activas = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);

  const [name, setName] = useState('');
  const [tipo, setTipo] = useState<TxType>(TxType.GASTO);
  const [montoTexto, setMontoTexto] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [jarId, setJarId] = useState('');
  const [repartir, setRepartir] = useState(false);
  const [paidBy, setPaidBy] = useState('');
  const [frecuencia, setFrecuencia] = useState<Frecuencia>('mensual');
  const [diaMes, setDiaMes] = useState(1);
  const [diaMes2, setDiaMes2] = useState<number>(QUINCENA_POR_DEFECTO[1]);
  const [diaSemana, setDiaSemana] = useState(1);
  const [mesAnio, setMesAnio] = useState(1);
  const [activo, setActivo] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    if (editando) {
      setName(editando.name);
      setTipo(editando.type);
      setMontoTexto(montoPlano(editando.amountMinor, moneda));
      setAccountId(editando.accountId);
      setCategoryId(editando.categoryId ?? '');
      setJarId(editando.jarId ?? '');
      setRepartir(editando.distributeToJars);
      setPaidBy(editando.paidBy ?? '');
      setFrecuencia(editando.frequency);
      setDiaMes(editando.dayOfMonth ?? 1);
      setDiaMes2(editando.dayOfMonth2 ?? QUINCENA_POR_DEFECTO[1]);
      setDiaSemana(editando.dayOfWeek ?? 1);
      setMesAnio(editando.monthOfYear ?? 1);
      setActivo(editando.active);
    } else {
      setName('');
      setTipo(TxType.GASTO);
      setMontoTexto('');
      setAccountId(activas[0]?.id ?? '');
      setCategoryId('');
      setJarId('');
      setRepartir(false);
      setPaidBy('');
      setFrecuencia('mensual');
      setDiaMes(new Date().getDate());
      setDiaMes2(QUINCENA_POR_DEFECTO[1]);
      setDiaSemana(1);
      setMesAnio(new Date().getMonth() + 1);
      setActivo(true);
    }
    setError(null);
  }, [abierto, editando, moneda, activas]);

  const montoMinor = parseMonto(montoTexto, moneda);
  const tipoCategoria = tipo === TxType.INGRESO ? 'ingreso' : 'gasto';
  const categoriasVisibles = categories.filter((c) => !c.archived && c.type === tipoCategoria);

  // De que economia es lo que se eligio. El pago habitual la hereda de su
  // categoria igual que un movimiento, asi que decirlo aca es decir a donde va
  // a caer la plata cada mes.
  const economias = entities.filter((e) => !e.archived);
  const suEconomia = entities.find(
    (e) => e.id === categories.find((c) => c.id === categoryId)?.entityId,
  );

  // Si el primer dia se mueve encima del segundo, se corre el segundo: es
  // menos molesto que bloquear el boton y dejar a la persona adivinando.
  const dia2Efectivo = frecuencia === 'quincenal' && diaMes2 === diaMes
    ? (diaMes === 31 ? 15 : 31)
    : diaMes2;

  /**
   * Que campos pide cada frecuencia.
   *
   * Se calcula una vez y se usa en los tres lugares que lo necesitan —dibujar
   * el formulario, armar la regla de la vista previa y guardar— porque la
   * version anterior lo repetia escrito a mano en cada uno. Con cuatro
   * frecuencias ya era facil que se desincronizaran; con seis, seguro.
   */
  const conDiaDeSemana = frecuencia === 'semanal';
  const conDiaDelMes = !conDiaDeSemana;
  const conSegundoDia = frecuencia === 'quincenal';
  const conMesAncla = frecuencia === 'trimestral' || frecuencia === 'semestral'
    || frecuencia === 'anual';

  const campos = {
    dayOfMonth: conDiaDelMes ? diaMes : null,
    dayOfMonth2: conSegundoDia ? dia2Efectivo : null,
    dayOfWeek: conDiaDeSemana ? diaSemana : null,
    monthOfYear: conMesAncla ? mesAnio : null,
  };

  const regla = reglaDe({ frequency: frecuencia, ...campos });
  const proxima = primeraFecha(regla);

  /**
   * Al pasar a quincenal se proponen el 15 y el ultimo dia.
   *
   * El dia que arrastraba la mensual es "hoy", que para un pago mensual es un
   * buen punto de partida y para una quincena no significa nada: quien cobra
   * cada quince dias casi siempre cobra el 15 y a fin de mes.
   */
  function cambiarFrecuencia(nueva: Frecuencia) {
    setFrecuencia(nueva);
    if (nueva === 'quincenal' && frecuencia !== 'quincenal') {
      setDiaMes(QUINCENA_POR_DEFECTO[0]);
      setDiaMes2(QUINCENA_POR_DEFECTO[1]);
    }
    if (nueva !== 'quincenal' && frecuencia === 'quincenal') {
      setDiaMes(new Date().getDate());
    }
    // Al pasar a una que se ancla a un mes, el ancla arranca en el mes
    // actual: es lo que hace que el primer cobro caiga lo antes posible en
    // vez de en enero del año que viene.
    if ((nueva === 'trimestral' || nueva === 'semestral') && !conMesAncla) {
      setMesAnio(new Date().getMonth() + 1);
    }
  }

  const puedeGuardar = name.trim() !== '' && montoMinor !== null && montoMinor > 0 && accountId !== '' && !guardando;

  async function guardar() {
    if (!puedeGuardar || montoMinor === null) return;
    setGuardando(true);
    setError(null);
    try {
      await guardarRecurrente({
        name: name.trim(),
        type: tipo,
        amountMinor: montoMinor,
        accountId,
        categoryId: categoryId || null,
        jarId: repartir ? null : (jarId || null),
        distributeToJars: tipo === TxType.INGRESO && repartir,
        paidBy: paidBy || null,
        frequency: frecuencia,
        ...campos,
        active: activo,
      }, editando?.id);
      alCerrar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo guardar';
      setError(msg);
      avisar(msg);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Hoja
      abierta={abierto}
      alCerrar={alCerrar}
      titulo={editando ? 'Editar pago habitual' : 'Nuevo pago habitual'}
      /* Guardar al pie y siempre visible, como en el formulario de
         movimientos. Con tres bloques y hasta catorce controles, al final del
         scroll significa recorrer todo para abajo cada vez. */
      pie={(
        <Boton onClick={() => void guardar()} disabled={!puedeGuardar} className="w-full min-h-12">
          {guardando ? 'Guardando...' : 'Guardar'}
        </Boton>
      )}
    >
      <div className="space-y-6">
        <Bloque titulo="Qué es">
        <Campo etiqueta="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alquiler, Netflix, Luz..." />

        <div className="grid grid-cols-2 gap-2">
          {[
            { id: TxType.GASTO, etiqueta: 'Gasto', color: '#ef4444' },
            { id: TxType.INGRESO, etiqueta: 'Ingreso', color: '#10b981' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTipo(t.id)}
              className={cn(
                'min-h-11 rounded-xl t-fila font-medium border transition-all',
                tipo === t.id ? 'text-white border-transparent' : 'superficie-2 borde txt-2',
              )}
              style={tipo === t.id ? { background: t.color } : undefined}
            >
              {t.etiqueta}
            </button>
          ))}
        </div>

        <Campo
          etiqueta="Monto"
          value={montoTexto}
          onChange={(e) => setMontoTexto(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
        />

        </Bloque>

        <Bloque titulo="Cuándo se cobra">
        {/* En orden, de la mas seguida a la mas espaciada, y desde la lista
            de shared/recurrencia.ts para que agregar una frecuencia nueva no
            haya que acordarse de escribirla tambien aca. Estaban sueltas y
            desordenadas —mensual, quincenal, semanal, anual—, que obliga a
            leer las cuatro para encontrar la que se busca. */}
        <Selector etiqueta="Frecuencia" value={frecuencia} onChange={(e) => cambiarFrecuencia(e.target.value as Frecuencia)}>
          {FRECUENCIAS.map((f) => (
            <option key={f} value={f}>
              {FRECUENCIA_LABEL[f]}{f === 'quincenal' ? ' (dos veces al mes)' : ''}
            </option>
          ))}
        </Selector>

        {conDiaDeSemana && (
          <Selector etiqueta="Día" value={diaSemana} onChange={(e) => setDiaSemana(Number(e.target.value))}>
            {DIAS_SEMANA.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </Selector>
        )}

        {conSegundoDia && (
          <div className="grid grid-cols-2 gap-3">
            <Selector etiqueta="Primer cobro" value={diaMes} onChange={(e) => setDiaMes(Number(e.target.value))}>
              {DIAS_DEL_MES.map((d) => <option key={d} value={d}>{etiquetaDia(d)}</option>)}
            </Selector>
            <Selector etiqueta="Segundo cobro" value={dia2Efectivo} onChange={(e) => setDiaMes2(Number(e.target.value))}>
              {DIAS_DEL_MES.filter((d) => d !== diaMes).map((d) => (
                <option key={d} value={d}>{etiquetaDia(d)}</option>
              ))}
            </Selector>
          </div>
        )}

        {conDiaDelMes && (
          <div className={cn('grid gap-3', conMesAncla ? 'grid-cols-2' : 'grid-cols-1')}>
            <Selector etiqueta="Día del mes" value={diaMes} onChange={(e) => setDiaMes(Number(e.target.value))}>
              {DIAS_DEL_MES.map((d) => <option key={d} value={d}>{etiquetaDia(d)}</option>)}
            </Selector>
            {conMesAncla && (
              /* En la anual es el mes en que se cobra. En la trimestral y la
                 semestral es desde dónde arranca el ciclo, y por eso la
                 etiqueta cambia: elegir «marzo» en una trimestral no quiere
                 decir «en marzo», quiere decir «marzo, junio, septiembre y
                 diciembre». Lo que se eligió se escribe entero debajo. */
              <Selector
                etiqueta={frecuencia === 'anual' ? 'Mes' : 'Empezando en'}
                value={mesAnio}
                onChange={(e) => setMesAnio(Number(e.target.value))}
              >
                {MESES.map((m, i) => <option key={m} value={i + 1} className="capitalize">{m}</option>)}
              </Selector>
            )}
          </div>
        )}

        {/* Los meses del ciclo, escritos. «Cada 3 meses» no dice CUÁLES, y
            para un impuesto trimestral eso es lo único que hace falta saber
            para poder anticiparlo. */}
        {(frecuencia === 'trimestral' || frecuencia === 'semestral') && (
          <p className="t-nota txt-3 px-1 -mt-2 leading-relaxed">
            Cae el {describirRegla(regla)}.
          </p>
        )}

        {/* Un día 29, 30 o 31 no existe en todos los meses. Decirlo acá evita
            la sorpresa de que el pago "se corrió". */}
        {conDiaDelMes && Math.max(diaMes, conSegundoDia ? dia2Efectivo : 0) > 28 && (
          <p className="t-nota txt-3 px-1 -mt-2 leading-relaxed">
            {frecuencia === 'quincenal'
              ? `${describirRegla(regla)}. En febrero, el último día es el 28 (o el 29).`
              : `En los meses que no tienen día ${diaMes}, se cobra el último día del mes.`}
          </p>
        )}

        {/* La próxima fecha, acá y no escondida dentro del interruptor de
            «Activo», que es donde estaba: es el resultado de todo este bloque
            —lo único que confirma que la regla quedó como se quería— y tiene
            que leerse junto a los campos que la producen. */}
        <div className="rounded-2xl superficie-2 borde border px-3.5 py-3 flex items-center gap-2.5">
          <Icono nombre="calendar-days" size={17} className="txt-3 shrink-0" />
          <p className="t-fila txt-2 min-w-0">
            {activo ? 'Próximo cobro: ' : 'Cuando lo reactives: '}
            <span className="font-semibold txt">
              {new Date(proxima).toLocaleDateString('es', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </span>
          </p>
        </div>
        </Bloque>

        <Bloque titulo="De dónde sale">
        {/* Agrupadas por dueño, igual que en el formulario de movimientos. */}
        <Selector etiqueta="Cuenta" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Elige una cuenta</option>
          {cuentasPorDueno(activas, members).map((g) => (
            <optgroup key={g.clave} label={g.nombre}>
              {g.cuentas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </Selector>

        {categoriasVisibles.length > 0 && (
          <div className="space-y-1.5">
            <Selector etiqueta="Categoría" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              <OpcionesPorEconomia items={categoriasVisibles} />
            </Selector>
            {/* Con el desplegable cerrado, "Suscripciones" a secas no dice cual
                de las dos es. Y de eso depende a que economia va el gasto. */}
            {economias.length > 1 && (
              <p className="t-nota px-1 leading-relaxed" style={{ color: suEconomia?.color }}>
                {suEconomia
                  ? `Va a ${suEconomia.name}`
                  : categoryId
                    ? 'Esta categoría no tiene economía asignada'
                    : 'Sin categoría no pertenece a ninguna economía'}
              </p>
            )}
          </div>
        )}

        {jars.length > 0 && !repartir && (
          <Selector etiqueta="Jarra" value={jarId} onChange={(e) => setJarId(e.target.value)}>
            <option value="">Sin jarra</option>
            <OpcionesPorEconomia items={jars} />
          </Selector>
        )}

        {/* Sin esto, un sueldo que entra por aca no puede llegar a ninguna
            jarra: el disparador insertaba los movimientos con el reparto
            apagado a mano. Es el agujero mas grande para quien cobra por
            quincena. */}
        {tipo === TxType.INGRESO && jars.length > 0 && (
          <button
            onClick={() => { setRepartir(!repartir); if (!repartir) setJarId(''); }}
            className={cn(
              'w-full flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all',
              repartir ? 'bg-marca-50 border-marca-500 dark:bg-marca-500/10' : 'superficie-2 borde',
            )}
          >
            <Ficha color="#10b981" icono="split" size={38} />
            <div className="flex-1 min-w-0">
              <p className="t-fila font-medium txt">Repartir entre las jarras</p>
              <p className="t-nota txt-3">
                Cada vez que se cargue, según los porcentajes de cada jarra
              </p>
            </div>
            <div className={cn(
              'w-11 h-6 rounded-full p-0.5 transition-colors shrink-0',
              repartir ? 'bg-marca-500' : 'superficie-2 borde border',
            )}>
              <div className={cn('w-5 h-5 rounded-full bg-white shadow transition-transform', repartir && 'translate-x-5')} />
            </div>
          </button>
        )}

        {members.length > 1 && (
          <Selector etiqueta="Quién lo paga" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            <option value="">Sin asignar</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
          </Selector>
        )}

        </Bloque>

        <button
          onClick={() => setActivo(!activo)}
          className={cn(
            'w-full flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all',
            activo ? 'bg-marca-50 border-marca-500 dark:bg-marca-500/10' : 'superficie-2 borde',
          )}
        >
          <Ficha color={activo ? '#10b981' : '#64748b'} icono={activo ? 'check' : 'circle'} size={38} />
          <div className="flex-1 min-w-0">
            <p className="t-fila font-medium txt">{activo ? 'Activo' : 'En pausa'}</p>
            <p className="t-nota txt-3">
              {activo
                ? 'Se carga solo el día que corresponde'
                : 'No se va a cargar hasta que lo reactives'}
            </p>
          </div>
          <div className={cn('w-11 h-6 rounded-full p-0.5 transition-colors shrink-0', activo ? 'bg-marca-500' : 'superficie borde border')}>
            <div className={cn('w-5 h-5 rounded-full bg-white shadow transition-transform', activo && 'translate-x-5')} />
          </div>
        </button>

        {error && <p className="t-fila text-red-500 text-center px-2">{error}</p>}
      </div>
    </Hoja>
  );
}
