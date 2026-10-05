/**
 * Jarras (metodo de los 6 frascos).
 *
 * Se conserva del repo original porque es una decision del hogar sobre como
 * repartir la plata, no un detalle tecnico. Lo que cambia es la aritmetica:
 * los porcentajes van en puntos base y el reparto usa el metodo del mayor
 * resto, asi la suma de las jarras siempre da exactamente el ingreso.
 */

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/store.tsx';
import { formatBp, formatMonto, montoPlano, parseMonto } from '@shared/money';
import {
  entidadDe, entidadPorDefecto, flujoDeJarras, indexarCategorias, jarrasDe,
  repartirEnJarras, sinAsignar, validarJarras,
} from '@shared/domain';
import { periodoMes, type Periodo } from '@shared/periodo';
import type { Entity, Jar, Transaction } from '@shared/types';
import { FilaMovimiento } from './Inicio.tsx';
import {
  Barra, Boton, Campo, Ficha, Hoja, Icono, Selector, SelectorIcono, Tarjeta, Vacio,
} from '../components/ui/base.tsx';
import { SelectorPeriodo } from '../components/ui/periodo.tsx';
import { useConfirmar } from '../components/ui/confirmar.tsx';
import { cn, fechaCorta } from '../lib/utils.ts';


const COLORES = ['#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#f59e0b', '#f43f5e', '#06b6d4', '#64748b'];

/** Como se llena la jarra, en una linea. */
function describirLlenado(j: Jar, moneda: string): string {
  if (j.fillKind === 'resto') return 'lo que sobre de cada ingreso';
  if (j.fillKind === 'fijo') return `${formatMonto(j.fillMinor ?? 0, moneda)} de cada ingreso`;
  return `${formatBp(j.percentageBp)} de cada ingreso`;
}

export function Jarras({ alVerMovimiento }: { alVerMovimiento: (tx: Transaction) => void }) {
  const {
    jars, accounts, imputaciones, jarTransfers, jarAportes, transactions, categoriasTodas,
    entities, entidadActiva, household, guardarJarras, ponerJarrasAlDia, avisar,
  } = useStore();
  const moneda = household?.currency ?? 'USD';

  // La casa reparte en frascos y cada negocio en los suyos. En "Todo" se ven
  // todas juntas, que es la unica vista que cuadra contra las cuentas: la
  // plata esta mezclada en las mismas cuentas aunque los sobres sean de
  // dueños distintos.
  const porDefecto = useMemo(() => entidadPorDefecto(entities), [entities]);
  const visibles = useMemo(
    () => (entidadActiva === null ? jars : jars.filter((j) => j.entityId === entidadActiva)),
    [jars, entidadActiva],
  );


  // En "Todo" con mas de una economia, cada tanda lleva su titulo: seis
  // frascos de la casa y tres de un negocio en una sola lista corrida no se
  // entienden, y los porcentajes de cada tanda suman 100% por separado.
  const grupos = useMemo((): { entidad: Entity | null; jarras: Jar[] }[] => {
    if (entidadActiva !== null) return [{ entidad: null, jarras: visibles }];

    const porEntidad = new Map<string, Jar[]>();
    for (const j of visibles) {
      const clave = j.entityId ?? '';
      porEntidad.set(clave, [...(porEntidad.get(clave) ?? []), j]);
    }
    if (porEntidad.size < 2) return [{ entidad: null, jarras: visibles }];

    const porId = new Map(entities.map((e) => [e.id, e]));
    return [...porEntidad]
      .map(([clave, jarras]) => ({ entidad: porId.get(clave) ?? null, jarras }))
      .sort((a, b) => (a.entidad?.displayOrder ?? 999) - (b.entidad?.displayOrder ?? 999));
  }, [visibles, entities, entidadActiva]);

  const [editando, setEditando] = useState(false);
  const [abierta, setAbierta] = useState<Jar | null>(null);
  const [traspasando, setTraspasando] = useState(false);
  const [asignando, setAsignando] = useState(false);
  // Desde y hacia que jarra, cuando la accion sale del detalle de una.
  const [desdeJarra, setDesdeJarra] = useState<string | undefined>();
  const [haciaJarra, setHaciaJarra] = useState<string | undefined>();
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoMes(Date.now()));
  const [poniendoAlDia, setPoniendoAlDia] = useState(false);

  const fechaDe = useMemo(() => {
    const mapa = new Map(transactions.map((t) => [t.id, t.date]));
    return (txId: string) => mapa.get(txId);
  }, [transactions]);

  // Lo que entro y salio en el periodo elegido. El saldo grande sigue siendo
  // el de toda la vida: es el que dice si se puede gastar.
  //
  // Los APORTES van adentro. El saldo siempre los conto y el flujo no, asi que
  // una jarra con $150 de saldo mostraba "entro $200, salio $559" y la barra
  // salia roja entera: le faltaban los $509 que se le habian repartido a mano
  // desde el sin asignar. Repartir a una jarra es plata que entra, igual que
  // un ingreso.
  const flujo = useMemo(
    () => flujoDeJarras(jars, imputaciones, jarTransfers, jarAportes, fechaDe, periodo),
    [jars, imputaciones, jarTransfers, fechaDe, periodo, jarAportes],
  );
  // La barra mide cuanto de lo que la jarra recibio EN TODA SU VIDA ya se
  // gasto. Medirlo contra el mes daria la barra llena en cuanto el ingreso
  // entre el mes anterior, aunque la jarra siga casi intacta.
  const flujoVida = useMemo(
    () => flujoDeJarras(jars, imputaciones, jarTransfers, jarAportes),
    [jars, imputaciones, jarTransfers, jarAportes],
  );

  // El sin asignar se mide contra TODAS las jarras, mire uno lo que mire: la
  // resta es entre las cuentas del hogar y todo lo que ya tiene dueño.
  const saldosVida = useMemo(
    () => new Map(jars.map((j) => [j.id, j.balanceMinor])),
    [jars],
  );
  const libre = useMemo(() => sinAsignar(accounts, saldosVida), [accounts, saldosVida]);
  const enCuentas = useMemo(
    () => jars.reduce((s, j) => s + j.balanceMinor, 0) + libre,
    [jars, libre],
  );

  // Ingresos que nunca llegaron a ninguna jarra. Hasta ahora repartir era un
  // interruptor apagado por defecto y no se encendio nunca.
  const huerfanos = useMemo(() => {
    const conImputacion = new Set(imputaciones.map((i) => i.txId));
    // Todas, papelera incluida: un ingreso viejo cuya categoría se tiró sigue
    // perteneciendo a su economía, y sin esto se colaba como «huérfano».
    const indice = indexarCategorias(categoriasTodas);
    return transactions.filter((t) => {
      if (t.type !== 2 || t.jarId || t.distributeToJars || conImputacion.has(t.id)) return false;
      // Sin jarras propias no hay donde repartirlo: ofrecerlo seria un boton
      // que no hace nada. El servidor lo saltea igual.
      const suyas = jarrasDe(jars, entidadDe(t, indice), porDefecto);
      if (suyas.length === 0) return false;
      return entidadActiva === null || suyas[0].entityId === entidadActiva;
    });
  }, [transactions, imputaciones, categoriasTodas, jars, porDefecto, entidadActiva]);

  async function alDia() {
    setPoniendoAlDia(true);
    try {
      const n = await ponerJarrasAlDia();
      avisar(n === 1 ? 'Se repartió 1 ingreso' : `Se repartieron ${n} ingresos`, 'ok');
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo repartir');
    } finally {
      setPoniendoAlDia(false);
    }
  }

  return (
    <div className="space-y-4">
      {visibles.length === 0 ? (
        <Tarjeta>
          <Vacio
            icono="piggy-bank"
            titulo={entidadActiva === null ? 'Sin jarras' : 'Todavía no reparte'}
            texto={entidadActiva === null
              ? 'Reparte cada ingreso en frascos con un propósito: necesidades, ahorro, diversión. Te da control sin llevar la cuenta a mano.'
              : 'Esta economía todavía no tiene jarras. Un negocio suele querer separar impuestos, insumos y publicidad de cada cobro, antes de que la plata se mezcle.'}
            accion={<Boton onClick={() => setEditando(true)}>Crear jarras</Boton>}
          />
        </Tarjeta>
      ) : (
        <>
          {/* Ya no hay tarjeta de conciliacion permanente. El recuadro con
              "En jarras / Sin asignar" estaba siempre, incluso con todo
              cuadrado, que es el caso normal: mostraba dos numeros y tres
              renglones de explicacion para decir que no pasa nada. Lo que de
              verdad hay que ver aparece abajo, y solo cuando hay algo que
              hacer: plata sin repartir, o jarras asignadas de mas. */}

          {libre < 0 && (
            <Tarjeta className="border-red-500/40">
              <h2 className="t-seccion font-semibold text-red-500 mb-1">
                Las jarras tienen {formatMonto(-libre, moneda)} de más
              </h2>
              <p className="t-nota txt-3">
                En las cuentas hay {formatMonto(enCuentas, moneda)}.
              </p>
            </Tarjeta>
          )}

          {/* Y la forma de bajarlo. Un numero que no se puede mover y no se
              explica enseña a desconfiar del resto de la pantalla. */}
          {libre > 0 && jars.length > 0 && (
            <Tarjeta className="border-marca-500/40">
              {/* Titulo de tarjeta, del mismo tamaño y grosor que los del
                  Inicio: estas tres tarjetas son cuadrantes igual que aquellos. */}
              <h2 className="t-seccion font-semibold txt mb-1">
                Hay {formatMonto(libre, moneda)} sin repartir
              </h2>
              {/* De donde sale ese numero. Sin esto la pantalla decia "Sin
                  asignar $887.10" con TODOS los movimientos asignados y no
                  habia forma de entenderlo: eran los saldos iniciales de las
                  cuentas, plata que ya estaba ahi y que las jarras nunca
                  vieron porque solo ven movimientos. */}
              <div className="mb-3" />
              <Boton onClick={() => setAsignando(true)} className="w-full">
                Repartirla entre las jarras
              </Boton>
            </Tarjeta>
          )}

          {huerfanos.length > 0 && (
            <Tarjeta className="border-marca-500/40">
              <h2 className="t-seccion font-semibold txt mb-1">
                {huerfanos.length === 1
                  ? 'Hay 1 ingreso que nunca se repartió'
                  : `Hay ${huerfanos.length} ingresos que nunca se repartieron`}
              </h2>
              <p className="t-nota txt-3 mb-3">
                Suman {formatMonto(huerfanos.reduce((a, t) => a + t.amountMinor, 0), moneda)}.
              </p>
              <Boton onClick={() => void alDia()} disabled={poniendoAlDia} className="w-full">
                {poniendoAlDia ? 'Repartiendo...' : 'Repartirlos ahora'}
              </Boton>
            </Tarjeta>
          )}

          <SelectorPeriodo periodo={periodo} alCambiar={setPeriodo} />

          {grupos.map((g) => (
          <div key={g.entidad?.id ?? 'todas'} className="space-y-2.5">
            {g.entidad && (
              <div className="flex items-center gap-2 pt-1" style={{ color: g.entidad.color }}>
                <Icono nombre={g.entidad.icon} size={15} />
                <span className="t-nota font-semibold uppercase tracking-wide">
                  {g.entidad.name}
                </span>
              </div>
            )}
            {g.jarras.map((j) => {
              const f = flujo.get(j.id) ?? { entroMinor: 0, salioMinor: 0 };
              const vida = flujoVida.get(j.id) ?? { entroMinor: 0, salioMinor: 0 };
              const enRojo = j.balanceMinor < 0;
              // El numero grande es SIEMPRE lo que queda. Es el que se usa
              // para decidir si se puede gastar, y el que cuadra contra las
              // cuentas. Mostrar el neto del mes aca haria que una jarra con
              // plata se leyera en negativo solo porque el ingreso entro el
              // mes pasado.
              const gastado = enRojo
                ? 1
                : vida.entroMinor > 0 ? vida.salioMinor / vida.entroMinor : 0;

              return (
                <Tarjeta key={j.id} className="p-4 active:opacity-70 transition-opacity cursor-pointer"
                  onClick={() => setAbierta(j)}>
                  <div className="flex items-center gap-3 mb-3">
                    <Ficha color={j.color} icono={j.icon} size={42} />
                    <div className="flex-1 min-w-0">
                      <p className="t-fila font-medium txt truncate">{j.name}</p>
                      {/* Sin `truncate`: a 390px «10% de cada ingreso · acumula»
                          se cortaba en «... · ...» y el dato desaparecia. Que
                          baje a dos renglones es mejor que un puntito. */}
                      <p className="t-nota txt-3 leading-snug">{describirLlenado(j, moneda)}</p>
                    </div>
                    {/* UN solo numero, y es lo que se puede gastar. Antes
                        estaba el saldo arriba y abajo «Puedes gastar» el MISMO
                        monto escrito de nuevo: dos renglones para un dato.
                        Queda el numero, porque es el que se busca, y la
                        palabra que lo explica va chiquita al lado. */}
                    <p className={cn(
                      't-fila font-semibold tabular shrink-0',
                      enRojo ? 'text-red-500' : 'txt',
                    )}>
                      {formatMonto(j.balanceMinor, moneda)}
                    </p>
                    <Icono nombre="chevron-right" size={16} className="txt-3 shrink-0 -mr-1" />
                  </div>

                  {/* Cuanto de lo que entro ya se gasto, en el color de la
                      jarra. Sin `alerta`: viraba a ambar pasando el 60% y a
                      rojo pasando el 100%, asi que una jarra sana que uso el
                      70% de lo suyo se veia como un problema. El rojo queda
                      para lo unico que si lo es: que no quede nada. */}
                  <Barra ratio={gastado} color={enRojo ? '#ef4444' : j.color} />

                  {/* Una sola linea abajo, y cambia segun haga falta: si algo
                      anda mal, lo que anda mal; si no, como viene el mes. El
                      resto del detalle esta a un toque de distancia. */}
                  {enRojo ? (
                    <p className="t-nota text-red-500 mt-2 leading-relaxed">
                      Salió más de lo que esta jarra recibió en toda su vida.
                      Pásale plata desde otra con «Mover».
                    </p>
                  ) : (
                    /* Sin el nombre del mes: lo dice el selector de arriba, y
                       repetirlo en cada una de las seis jarras es la misma
                       palabra seis veces. */
                    <p className="t-nota txt-3 mt-2">
                      {f.entroMinor === 0 && f.salioMinor === 0 ? (
                        'Sin movimientos'
                      ) : (
                        <>
                          Entró <span className="tabular">{formatMonto(f.entroMinor, moneda)}</span>
                          {' · Salió '}
                          <span className="tabular">{formatMonto(f.salioMinor, moneda)}</span>
                        </>
                      )}
                    </p>
                  )}
                </Tarjeta>
              );
            })}
          </div>
          ))}

        </>
      )}

      <MovimientosDeJarra
        jarra={abierta}
        alCerrar={() => setAbierta(null)}
        alVerMovimiento={(tx) => { setAbierta(null); alVerMovimiento(tx); }}
        alMover={() => { setDesdeJarra(abierta?.id); setAbierta(null); setTraspasando(true); }}
        alPoner={() => { setHaciaJarra(abierta?.id); setAbierta(null); setAsignando(true); }}
        alEditar={() => { setAbierta(null); setEditando(true); }}
      />

      <HojaTraspaso
        abierta={traspasando}
        alCerrar={() => { setTraspasando(false); setDesdeJarra(undefined); }}
        desde={desdeJarra}
      />

      <HojaAsignar
        abierta={asignando}
        alCerrar={() => { setAsignando(false); setHaciaJarra(undefined); }}
        disponible={libre}
        hacia={haciaJarra}
      />

      <EditorJarras
        abierta={editando}
        alCerrar={() => setEditando(false)}
        jarras={jars}
        alGuardar={async (nuevas) => {
          try {
            await guardarJarras(nuevas);
            setEditando(false);
          } catch (e) {
            avisar(e instanceof Error ? e.message : 'No se pudo guardar');
          }
        }}
      />
    </div>
  );
}

/**
 * Mover plata de una jarra a otra.
 *
 * No toca ninguna cuenta: la plata sigue donde estaba, lo que cambia es para
 * que esta. Es lo unico que permite sacar del rojo a una jarra en la que se
 * gasto de mas.
 */
function HojaTraspaso({ abierta, alCerrar, desde }: {
  abierta: boolean; alCerrar: () => void; desde?: string;
}) {
  const {
    jars: todas, entities, entidadActiva, household,
    traspasarEntreJarras, pagarAOtraEconomia, avisar,
  } = useStore();
  const moneda = household?.currency ?? 'USD';

  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  // Vacio = mover adentro de la misma economia. Con valor = pagarle a otra.
  const [economiaDestino, setEconomiaDestino] = useState('');
  const [montoTexto, setMontoTexto] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  const variasEconomias = useMemo(
    () => new Set(todas.map((j) => j.entityId ?? '')).size > 1,
    [todas],
  );

  // Un traspaso re-etiqueta plata dentro de una misma economia: por eso el
  // destino se limita a las hermanas de la jarra de origen. Sacar de los
  // impuestos de PanaClaw para tapar la comida de la casa no es mover un
  // sobre, es que el negocio le pago a la casa — y para eso esta el modo pago,
  // abajo en "A".
  //
  // El origen, en cambio, muestra TODAS: si no, elegir una jarra de un negocio
  // dejaba encerrado ahi y no habia forma de volver a las de la casa.
  const jars = useMemo(() => {
    const ancla = todas.find((j) => j.id === (desde ?? origen));
    const entidad = ancla?.entityId ?? entidadActiva ?? null;
    if (entidad === null) return todas;
    return todas.filter((j) => j.entityId === entidad);
  }, [todas, desde, origen, entidadActiva]);

  /** Las jarras agrupadas por economia, para el selector de origen. */
  const porEconomia = useMemo(() => {
    if (!variasEconomias) return null;
    return entities
      .filter((e) => todas.some((j) => j.entityId === e.id))
      .map((e) => ({ economia: e, jarras: todas.filter((j) => j.entityId === e.id) }));
  }, [entities, todas, variasEconomias]);

  useEffect(() => {
    if (!abierta) return;
    // Por defecto, de la que mas tiene a la que esta en rojo: es el caso que
    // trae a alguien a esta pantalla.
    const enRojo = jars.find((j) => j.balanceMinor < 0);
    const conMas = [...jars].sort((a, b) => b.balanceMinor - a.balanceMinor)[0];
    setOrigen(desde ?? conMas?.id ?? '');
    setDestino(enRojo && enRojo.id !== (desde ?? conMas?.id) ? enRojo.id : '');
    setEconomiaDestino('');
    setMontoTexto(enRojo ? montoPlano(-enRojo.balanceMinor, moneda) : '');
    setNota('');
    // Solo al abrir: recalcular con cada tecla pisaria lo que se esta eligiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierta, desde, moneda]);

  const monto = parseMonto(montoTexto, moneda);
  const jarraOrigen = todas.find((j) => j.id === origen);
  const esPago = economiaDestino !== '';

  // Las economias que podrian cobrar: las que no son la del origen y tienen
  // jarras donde poner la plata.
  const puedenCobrar = useMemo(() => entities.filter((e) => (
    !e.archived
    && e.id !== (jarraOrigen?.entityId ?? null)
    && todas.some((j) => j.entityId === e.id)
  )), [entities, todas, jarraOrigen]);

  // Como caeria el pago, con las reglas de la economia que cobra.
  const repartoDelPago = useMemo(() => {
    if (!esPago || monto === null || monto <= 0) return [];
    const destinoJarras = todas.filter((j) => j.entityId === economiaDestino);
    const partes = repartirEnJarras(monto, destinoJarras);
    return destinoJarras
      .map((jarra) => ({ jarra, parte: partes.get(jarra.id) ?? 0 }))
      .filter((x) => x.parte !== 0);
  }, [esPago, monto, todas, economiaDestino]);

  const puede = origen !== ''
    && (esPago ? repartoDelPago.length > 0 : destino !== '' && origen !== destino)
    && monto !== null && monto > 0 && !guardando;

  async function guardar() {
    if (!puede || monto === null) return;
    setGuardando(true);
    try {
      if (esPago) {
        await pagarAOtraEconomia({
          fromJarId: origen, toEntityId: economiaDestino, amountMinor: monto,
          note: nota.trim() || undefined,
        });
      } else {
        await traspasarEntreJarras({
          fromJarId: origen, toJarId: destino, amountMinor: monto, note: nota.trim() || undefined,
        });
      }
      alCerrar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo mover');
    } finally {
      setGuardando(false);
    }
  }

  if (!abierta) return null;

  return (
    <Hoja abierta alCerrar={alCerrar} titulo={esPago ? 'Pagarle a otra economía' : 'Mover entre jarras'}>
      <div className="space-y-4">
        <Selector
          etiqueta="De"
          value={origen}
          onChange={(e) => {
            setOrigen(e.target.value);
            // El destino viejo puede ser de otra economia: se limpia para no
            // mandar un traspaso que cruza sin querer.
            setDestino('');
            setEconomiaDestino('');
          }}
        >
          <option value="">Elige una jarra</option>
          {porEconomia
            ? porEconomia.map(({ economia, jarras }) => (
              <optgroup key={economia.id} label={economia.name}>
                {jarras.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name} · {formatMonto(j.balanceMinor, moneda)}
                  </option>
                ))}
              </optgroup>
            ))
            : todas.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} · {formatMonto(j.balanceMinor, moneda)}
              </option>
            ))}
        </Selector>

        {/* El destino: otra jarra de la misma economia, o directamente otra
            economia. Lo segundo es el escalon que usan ellos —el negocio le
            paga a la casa— y se ve distinto porque es otra cosa. */}
        <Selector
          etiqueta="A"
          value={esPago ? `e:${economiaDestino}` : destino}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('e:')) { setEconomiaDestino(v.slice(2)); setDestino(''); }
            else { setEconomiaDestino(''); setDestino(v); }
          }}
        >
          <option value="">Elige a dónde va</option>
          {jars.filter((j) => j.id !== origen).map((j) => (
            <option key={j.id} value={j.id}>
              {j.name} · {formatMonto(j.balanceMinor, moneda)}
            </option>
          ))}
          {puedenCobrar.length > 0 && (
            <optgroup label="Pagarle a otra economía">
              {puedenCobrar.map((e) => (
                <option key={e.id} value={`e:${e.id}`}>
                  {e.name} · se reparte en sus jarras
                </option>
              ))}
            </optgroup>
          )}
        </Selector>

        <Campo
          etiqueta="Monto"
          value={montoTexto}
          onChange={(e) => setMontoTexto(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
        />

        {/* No se bloquea: a veces la jarra de origen tambien esta en rojo y
            aun asi conviene mover. Pero se dice. */}
        {jarraOrigen && monto !== null && monto > jarraOrigen.balanceMinor && (
          <p className="t-nota text-amber-600 dark:text-amber-500 px-1 -mt-2 leading-relaxed">
            {jarraOrigen.name} queda en{' '}
            {formatMonto(jarraOrigen.balanceMinor - monto, moneda)}.
          </p>
        )}

        {/* Como cae el pago, antes de hacerlo. Con las reglas de quien cobra,
            no las de quien paga. */}
        {esPago && repartoDelPago.length > 0 && (
          <div className="superficie-2 rounded-2xl p-3 space-y-1.5 -mt-1">
            <p className="t-nota txt-2 mb-1.5">
              Entra repartido en las jarras de{' '}
              {entities.find((e) => e.id === economiaDestino)?.name}:
            </p>
            {repartoDelPago.map(({ jarra, parte }) => (
              <div key={jarra.id} className="flex items-center justify-between gap-2 t-nota">
                <span className="txt-2 truncate">{jarra.name}</span>
                <span className="tabular font-medium txt shrink-0">
                  {formatMonto(parte, moneda)}
                </span>
              </div>
            ))}
          </div>
        )}

        <Campo
          etiqueta="Por qué (opcional)"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder={esPago ? 'Lo que me tocó de septiembre...' : 'Me pasé con la comida...'}
          maxLength={200}
        />

        <Boton onClick={() => void guardar()} disabled={!puede} className="w-full min-h-12">
          {guardando
            ? (esPago ? 'Pagando...' : 'Moviendo...')
            : (esPago ? 'Pagar' : 'Mover')}
        </Boton>
      </div>
    </Hoja>
  );
}

/**
 * Movimientos que tocaron una jarra.
 *
 * No alcanza con filtrar por jar_id: un ingreso repartido no apunta a ninguna
 * jarra en particular, pero le entro plata a todas. La lista sale de las
 * mismas imputaciones congeladas que suman el saldo, asi que lo que se ve y
 * lo que dice el numero de arriba son lo mismo por construccion.
 */
function MovimientosDeJarra({ jarra, alCerrar, alVerMovimiento, alMover, alPoner, alEditar }: {
  jarra: Jar | null;
  alCerrar: () => void;
  alVerMovimiento: (tx: Transaction) => void;
  /** Mover plata desde esta jarra a otra. */
  alMover: () => void;
  /** Poner plata acá desde lo que está sin asignar. */
  alPoner: () => void;
  /** Abrir el editor de jarras. */
  alEditar: () => void;
}) {
  const {
    transactions, imputaciones, jarAportes, household, borrarAporte, avisar,
  } = useStore();
  const confirmar = useConfirmar();
  const moneda = household?.currency ?? 'USD';

  const movimientos = useMemo(() => {
    if (!jarra) return [];
    const porTx = new Map(transactions.map((t) => [t.id, t]));
    return imputaciones
      .filter((i) => i.jarId === jarra.id && i.amountMinor !== 0)
      .map((i) => ({ tx: porTx.get(i.txId), delta: i.amountMinor }))
      .filter((x): x is { tx: Transaction; delta: number } => x.tx !== undefined);
  }, [jarra, transactions, imputaciones]);

  const aportes = useMemo(
    () => (jarra ? jarAportes.filter((a) => a.jarId === jarra.id) : []),
    [jarra, jarAportes],
  );

  /**
   * Todo lo que le paso a la jarra, en una sola linea de tiempo.
   *
   * Lo repartido a mano estaba clavado arriba en su propia seccion, como si
   * fuera otra cosa. No lo es: es plata que entro a la jarra un dia concreto,
   * igual que un ingreso. Fijado arriba rompia el orden y hacia imposible ver
   * que paso primero y que despues.
   */
  const historia = useMemo(() => {
    const items: {
      id: string; fecha: number; delta: number;
      tx?: Transaction; aporteId?: string; nota?: string;
    }[] = [
      ...movimientos.map(({ tx, delta }) => ({ id: tx.id, fecha: tx.date, delta, tx })),
      ...aportes.map((a) => ({
        id: `ap-${a.id}`, fecha: a.date, delta: a.amountMinor,
        aporteId: a.id, nota: a.note ?? 'Repartido desde sin asignar',
      })),
    ];
    return items.sort((a, b) => b.fecha - a.fecha);
  }, [movimientos, aportes]);

  if (!jarra) return null;

  // Los aportes cuentan como lo que son: plata que entro a la jarra. Sin esto
  // "Entro" mostraba solo lo que vino de movimientos y quedaba mas chico que
  // "Salio" en jarras que estaban perfectamente en positivo.
  const entro = movimientos.filter((m) => m.delta > 0).reduce((a, m) => a + m.delta, 0)
    + aportes.filter((a) => a.amountMinor > 0).reduce((t, a) => t + a.amountMinor, 0);
  const salio = movimientos.filter((m) => m.delta < 0).reduce((a, m) => a - m.delta, 0)
    + aportes.filter((a) => a.amountMinor < 0).reduce((t, a) => t - a.amountMinor, 0);

  return (
    <Hoja
      abierta
      alCerrar={alCerrar}
      titulo={jarra.name}
      accion={(
        <button
          onClick={alEditar}
          aria-label="Editar esta jarra"
          className="w-9 h-9 rounded-full superficie-2 flex items-center justify-center txt-2 active:scale-[0.92] transition-transform duration-100"
        >
          <Icono nombre="settings-2" size={16} />
        </button>
      )}
      /* Las dos cosas que se hacen desde acá, siempre a la vista. Antes había
         que cerrar la hoja, buscar «Mover» arriba de todo y elegir de nuevo la
         jarra que ya se estaba mirando. */
      pie={(
        <div className="flex gap-2">
          <Boton variante="secundario" onClick={alPoner} className="flex-1 min-h-12">
            <Icono nombre="hand-coins" size={16} /> Poner plata
          </Boton>
          <Boton variante="secundario" onClick={alMover} className="flex-1 min-h-12">
            <Icono nombre="arrow-left-right" size={16} /> Mover
          </Boton>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-col items-center text-center pt-1">
          <Ficha color={jarra.color} icono={jarra.icon} size={52} />
          <p className={cn(
            't-cifra font-bold tabular tracking-tight mt-3',
            jarra.balanceMinor < 0 ? 'text-red-500' : 'txt',
          )}>
            {formatMonto(jarra.balanceMinor, moneda)}
          </p>
          <p className="t-nota txt-3 mt-1">{describirLlenado(jarra, moneda)}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="superficie-2 rounded-2xl p-3 text-center">
            <p className="t-nota txt-3 mb-0.5">Entró</p>
            <p className={cn(
              't-fila font-semibold tabular',
              entro > 0 ? 'text-marca-600 dark:text-marca-500' : 'txt-3',
            )}>
              {formatMonto(entro, moneda)}
            </p>
          </div>
          <div className="superficie-2 rounded-2xl p-3 text-center">
            <p className="t-nota txt-3 mb-0.5">Salió</p>
            {/* Neutro. Que de una jarra haya salido plata es exactamente para
                lo que existe la jarra: no es una alarma. El rojo aparece si
                salio MAS de lo que entro, y eso ya lo dice el saldo de arriba. */}
            <p className={cn(
              't-fila font-semibold tabular',
              salio > 0 ? 'txt' : 'txt-3',
            )}>
              {formatMonto(salio, moneda)}
            </p>
          </div>
        </div>

        {historia.length === 0 ? (
          <Vacio
            icono="receipt-text"
            titulo="Sin movimientos"
            texto="Esta jarra todavía no recibió ni gastó nada. Reparte un ingreso o impútale un gasto."
          />
        ) : (
          <div>
            <p className="t-nota font-medium txt-3 px-1 mb-1">
              {historia.length} movimiento{historia.length > 1 ? 's' : ''}
            </p>
            <div className="divide-y divide-[var(--borde)]">
              {historia.map((h) => (h.tx ? (
                /* El monto que se ve es lo que entro o salio DE ESTA JARRA, no
                   el del movimiento: de eso se encarga `deltaMinor`. */
                <FilaMovimiento
                  key={h.id}
                  tx={h.tx}
                  deltaMinor={h.delta}
                  alTocar={() => alVerMovimiento(h.tx!)}
                />
              ) : (
                /* Un aporte no se abre —no hay movimiento detras— pero se
                   deshace desde su propia fila. */
                <div key={h.id} className="flex items-center gap-3 py-3 px-1">
                  <Ficha color={jarra.color} icono="hand-coins" size={40} />
                  <div className="flex-1 min-w-0">
                    <p className="t-fila font-medium txt truncate">{h.nota}</p>
                    <p className="t-nota txt-3">{fechaCorta(h.fecha)}</p>
                  </div>
                  <span className={cn(
                    't-fila tabular font-semibold shrink-0',
                    h.delta > 0 ? 'text-marca-600 dark:text-marca-500' : 'txt',
                  )}>
                    {h.delta > 0 ? '+' : '−'}{formatMonto(Math.abs(h.delta), moneda)}
                  </span>
                  {/* Preguntando primero, como todo lo que borra.
                      Era el unico boton de papelera de la app que no preguntaba:
                      un toque y el reparto se deshacia. Y encima es de los mas
                      faciles de tocar sin querer, porque vive al final de una
                      fila de una lista que se recorre con el dedo. La plata no
                      se pierde —vuelve a «sin asignar»— pero el reparto si, y
                      eso es justo lo que hay que decir antes. */}
                  <button
                    onClick={async () => {
                      const ok = await confirmar({
                        titulo: '¿Deshacer esta asignación?',
                        detalle: `${formatMonto(Math.abs(h.delta), moneda)} `
                          + `${h.delta > 0 ? 'salen de' : 'vuelven a'} «${jarra.name}» y `
                          + 'vuelven a «sin asignar». No se pierde plata: se deshace el reparto.',
                        confirmar: 'Deshacer',
                        cancelar: 'Dejarla',
                        destructivo: true,
                      });
                      if (ok !== true) return;
                      try {
                        await borrarAporte(h.aporteId!);
                      } catch (e) {
                        avisar(e instanceof Error ? e.message : 'No se pudo deshacer');
                      }
                    }}
                    aria-label="Deshacer esta asignación"
                    className="w-9 h-9 rounded-lg flex items-center justify-center txt-3 shrink-0"
                  >
                    <Icono nombre="trash-2" size={15} />
                  </button>
                </div>
              )))}
            </div>
          </div>
        )}
      </div>
    </Hoja>
  );
}

interface Borrador {
  id?: string;
  name: string;
  percentageBp: number;
  color: string;
  icon: string;
  acumula: boolean;
  fillKind: 'porcentaje' | 'fijo' | 'resto';
  fillMinor: number | null;
}

/** Los seis frascos de siempre, para una economia personal que arranca. */
const FRASCOS_CASA: Omit<Borrador, 'id'>[] = [
  { name: 'Necesidades', percentageBp: 5500, color: '#3b82f6', icon: 'house', acumula: false, fillKind: 'porcentaje', fillMinor: null },
  { name: 'Ahorro largo plazo', percentageBp: 1000, color: '#10b981', icon: 'piggy-bank', acumula: true, fillKind: 'porcentaje', fillMinor: null },
  { name: 'Educación', percentageBp: 1000, color: '#8b5cf6', icon: 'graduation-cap', acumula: false, fillKind: 'porcentaje', fillMinor: null },
  { name: 'Diversión', percentageBp: 1000, color: '#ec4899', icon: 'party-popper', acumula: false, fillKind: 'porcentaje', fillMinor: null },
  { name: 'Libertad financiera', percentageBp: 1000, color: '#f59e0b', icon: 'trending-up', acumula: true, fillKind: 'porcentaje', fillMinor: null },
  { name: 'Donaciones', percentageBp: 500, color: '#f43f5e', icon: 'heart-handshake', acumula: false, fillKind: 'porcentaje', fillMinor: null },
];

/**
 * Lo que un negocio suele querer apartar de cada cobro antes de que la plata
 * se mezcle. La ultima es de resto, asi que la suma cierra sola y el cobro
 * puede ser de $50 o de $5.000 sin tocar nada.
 */
const FRASCOS_NEGOCIO: Omit<Borrador, 'id'>[] = [
  { name: 'Impuestos', percentageBp: 2000, color: '#f43f5e', icon: 'landmark', acumula: true, fillKind: 'porcentaje', fillMinor: null },
  { name: 'Insumos', percentageBp: 1000, color: '#f59e0b', icon: 'package', acumula: false, fillKind: 'porcentaje', fillMinor: null },
  { name: 'Publicidad', percentageBp: 1000, color: '#8b5cf6', icon: 'megaphone', acumula: false, fillKind: 'porcentaje', fillMinor: null },
  { name: 'Para repartir', percentageBp: 0, color: '#10b981', icon: 'hand-coins', acumula: true, fillKind: 'resto', fillMinor: null },
];

function EditorJarras({ abierta, alCerrar, jarras, alGuardar }: {
  abierta: boolean;
  alCerrar: () => void;
  jarras: Jar[];
  alGuardar: (jars: Partial<Jar>[]) => Promise<void>;
}) {
  const { entities, entidadActiva, household, imputaciones } = useStore();
  const confirmar = useConfirmar();
  const moneda = household?.currency ?? 'USD';

  const economias = useMemo(() => entities.filter((e) => !e.archived), [entities]);
  const porDefecto = useMemo(() => entidadPorDefecto(entities), [entities]);

  // Se edita UNA economia por vez. Los porcentajes suman 100% dentro de cada
  // una, asi que mezclarlas en una sola lista mostraria un 200% que no
  // significa nada.
  const [entidad, setEntidad] = useState<string | null>(null);
  const [borradores, setBorradores] = useState<Borrador[]>([]);
  const [iconoAbierto, setIconoAbierto] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);

  /** Sube o baja una jarra. El orden se guarda al guardar, como todo lo demas. */
  const mover = (i: number, paso: number) => {
    const j = i + paso;
    if (j < 0 || j >= borradores.length) return;
    setBorradores((prev) => {
      const copia = [...prev];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
    setIconoAbierto(null);
  };

  useEffect(() => {
    if (!abierta) return;
    setEntidad(entidadActiva ?? porDefecto);
  }, [abierta, entidadActiva, porDefecto]);

  useEffect(() => {
    if (!abierta) return;
    const suyas = jarras.filter((j) => j.entityId === entidad);
    const clase = economias.find((e) => e.id === entidad)?.kind;
    setBorradores(
      suyas.length > 0
        ? suyas.map((j) => ({
          id: j.id, name: j.name, percentageBp: j.percentageBp, color: j.color,
          icon: j.icon, acumula: j.acumula, fillKind: j.fillKind, fillMinor: j.fillMinor,
        }))
        : (clase === 'negocio' ? FRASCOS_NEGOCIO : FRASCOS_CASA).map((b) => ({ ...b })),
    );
  }, [abierta, jarras, entidad, economias]);

  const sumaBp = borradores.reduce((s, b) => s + b.percentageBp, 0);
  const { ok, motivo } = validarJarras(borradores as Jar[]);
  const hayResto = borradores.some((b) => b.fillKind === 'resto');

  const cambiar = (i: number, campo: keyof Borrador, valor: string | number | boolean | null) => {
    setBorradores((prev) => prev.map((b, k) => (k === i ? { ...b, [campo]: valor } : b)));
  };

  /**
   * Quitar una jarra, preguntando primero.
   *
   * Borrar una jarra con plata adentro no pierde ni un centavo —el saldo se
   * calcula, no se guarda, y vuelve a «sin asignar»— pero SÍ se lleva por
   * delante el reparto de todo lo que le entró alguna vez. Eso no se deshace
   * con un toque, así que no puede salir de un toque.
   */
  const quitar = async (i: number) => {
    const b = borradores[i];
    const nueva = !b.id;

    // Lo que esta jarra tiene hoy y lo que le pasó en su vida, para poder
    // decirlo antes en vez de que se descubra después.
    const jarra = b.id ? jarras.find((j) => j.id === b.id) : undefined;
    const movimientos = b.id
      ? imputaciones.filter((x) => x.jarId === b.id && x.amountMinor !== 0).length
      : 0;

    if (!nueva) {
      const ok = await confirmar({
        titulo: `¿Quitar "${b.name || 'esta jarra'}"?`,
        detalle: movimientos > 0
          ? `Tiene ${formatMonto(jarra?.balanceMinor ?? 0, moneda)} y ${movimientos} `
            + `movimiento${movimientos === 1 ? '' : 's'} repartidos. No se pierde plata: `
            + 'vuelve a «sin asignar». Lo que no vuelve es el reparto.'
          : 'Todavía no recibió nada.',
        confirmar: 'Quitar',
        cancelar: 'Dejarla',
        destructivo: true,
      });
      if (ok !== true) return;
    }

    setBorradores((p) => p.filter((_, k) => k !== i));
  };

  /**
   * Reparte lo que falta o sobra para llegar a 100% entre todas las jarras,
   * proporcionalmente. Evita la pelea de ajustar porcentajes a mano hasta que
   * el numero cierre.
   */
  const emparejar = () => {
    // Solo se reparten las de porcentaje: una jarra fija o de resto no tiene
    // porcentaje que ajustar.
    const indices = borradores
      .map((b, i) => (b.fillKind === 'porcentaje' ? i : -1))
      .filter((i) => i >= 0);
    if (indices.length === 0) return;

    const objetivo = 10_000;
    const actual = indices.reduce((t, i) => t + borradores[i].percentageBp, 0) || 1;

    let acumulado = 0;
    const ajustadas = [...borradores];
    indices.forEach((idx, k) => {
      const nuevo = k === indices.length - 1
        // La ultima se lleva exactamente lo que falta: la suma cierra siempre.
        ? objetivo - acumulado
        : Math.round((borradores[idx].percentageBp / actual) * objetivo);
      acumulado += nuevo;
      ajustadas[idx] = { ...ajustadas[idx], percentageBp: nuevo };
    });

    setBorradores(ajustadas);
  };

  return (
    <Hoja abierta={abierta} alCerrar={alCerrar} titulo="Ajustar jarras">
      <div className="space-y-3">
        {economias.length > 1 && (
          <>
            <Selector
              etiqueta="Economía"
              value={entidad ?? ''}
              onChange={(e) => setEntidad(e.target.value || null)}
            >
              {economias.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </Selector>
          </>
        )}

        <div className={cn(
          'rounded-2xl p-3.5 t-fila flex items-center gap-2.5',
          ok ? 'bg-marca-50 text-marca-700 dark:bg-marca-500/10 dark:text-marca-500' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-500',
        )}>
          <Icono nombre={ok ? 'circle-check' : 'triangle-alert'} size={17} />
          <span className="flex-1">
            {/* Con una jarra de resto la suma no tiene que dar 100%: lo que
                falte lo absorbe ella. Decir "suman 40%" ahi asustaria sin
                motivo. */}
            {hayResto
              ? <>Los porcentajes suman {formatBp(sumaBp)} · el resto va a la última</>
              : <>Suman {formatBp(sumaBp)}{!ok && ' · tienen que sumar 100%'}</>}
          </span>
          {!ok && !hayResto && (
            <button onClick={emparejar} className="font-medium underline shrink-0">
              Emparejar
            </button>
          )}
        </div>

        {!ok && motivo && (
          <p className="t-nota text-amber-700 dark:text-amber-500 px-1 leading-relaxed">
            {motivo}
          </p>
        )}

        {borradores.map((b, i) => (
          <div key={b.id ?? `nueva-${i}`} className="superficie-2 rounded-2xl p-3 space-y-3">
            <div className="flex items-center gap-2.5">
              {/* La ficha abre el selector de iconos. Es el mismo que usan las
                  categorias: un candado no es un chanchito, y la jarra se
                  reconoce de un vistazo por el icono, no leyendo el nombre. */}
              <button
                onClick={() => setIconoAbierto(iconoAbierto === i ? null : i)}
                aria-label={`Cambiar el ícono de ${b.name}`}
                className="shrink-0 rounded-xl active:scale-95 transition-transform"
              >
                <Ficha color={b.color} icono={b.icon} size={38} />
              </button>
              <input
                value={b.name}
                onChange={(e) => cambiar(i, 'name', e.target.value)}
                placeholder="Nombre"
                className="flex-1 min-w-0 min-h-10 px-3 rounded-xl superficie borde border txt t-campo outline-none focus:border-marca-500"
              />
              <button
                onClick={() => void quitar(i)}
                aria-label={`Quitar ${b.name}`}
                className="w-10 h-10 rounded-xl flex items-center justify-center txt-3 shrink-0"
              >
                <Icono nombre="trash-2" size={17} />
              </button>
            </div>

            {iconoAbierto === i && (
              <div className="superficie rounded-2xl p-2.5 borde border">
                <SelectorIcono
                  valor={b.icon}
                  color={b.color}
                  alElegir={(n) => { cambiar(i, 'icon', n); setIconoAbierto(null); }}
                />
              </div>
            )}

            {/* Mover de lugar. Flechas y no arrastrar: en un telefono, arrastrar
                dentro de una hoja que ya se desplaza pelea con el scroll, y
                estas jarras se ordenan una vez y no se tocan mas. */}
            {borradores.length > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => mover(i, -1)}
                  disabled={i === 0}
                  aria-label={`Subir ${b.name}`}
                  className="w-9 h-9 rounded-xl superficie borde border flex items-center justify-center txt-2 disabled:opacity-30 active:scale-95 transition-transform"
                >
                  <Icono nombre="chevron-up" size={16} />
                </button>
                <button
                  onClick={() => mover(i, 1)}
                  disabled={i === borradores.length - 1}
                  aria-label={`Bajar ${b.name}`}
                  className="w-9 h-9 rounded-xl superficie borde border flex items-center justify-center txt-2 disabled:opacity-30 active:scale-95 transition-transform"
                >
                  <Icono nombre="chevron-down" size={16} />
                </button>
                <span className="t-nota txt-3 ml-1">
                  {i + 1} de {borradores.length}
                </span>
              </div>
            )}

            {/* Como se llena. Un frasco de la casa va por porcentaje porque el
                sueldo es parejo; un cobro de agencia va de $50 a $5.000 y ahi
                "$100 de publicidad" dice mas que un 3%. */}
            <div className="flex gap-1.5">
              {([
                ['porcentaje', '%'],
                ['fijo', 'Monto fijo'],
                ['resto', 'Lo que sobre'],
              ] as const).map(([clase, etiqueta]) => (
                <button
                  key={clase}
                  onClick={() => {
                    cambiar(i, 'fillKind', clase);
                    // Solo una jarra puede quedarse con el resto: dos se lo
                    // repartirian sin ninguna regla.
                    if (clase === 'resto') {
                      setBorradores((prev) => prev.map((o, k) => (
                        k !== i && o.fillKind === 'resto'
                          ? { ...o, fillKind: 'porcentaje' as const }
                          : o
                      )));
                    }
                  }}
                  className={cn(
                    'flex-1 min-h-9 rounded-xl t-nota font-medium border transition-colors',
                    b.fillKind === clase
                      ? 'bg-marca-600 text-white border-transparent'
                      : 'superficie borde txt-2',
                  )}
                >
                  {etiqueta}
                </button>
              ))}
            </div>

            {b.fillKind === 'porcentaje' && (
              /*
               * Antes era un `range` pelado de 0 a 100 en 200px: cada píxel
               * valía medio punto, así que el dedo movía el porcentaje de a
               * saltos y no había forma de dejarlo en un número redondo.
               *
               * Ahora el número está en el medio, con un botón a cada lado que
               * mueve de a UNO —esa es la precisión— y la barra abajo para
               * llegar rápido a la zona, ya con paso de 1%. Los dos escriben
               * el mismo valor entero.
               */
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => cambiar(i, 'percentageBp', Math.max(0, b.percentageBp - 100))}
                    disabled={b.percentageBp <= 0}
                    aria-label={`Bajar un punto el porcentaje de ${b.name}`}
                    className="w-11 h-11 rounded-xl superficie borde border flex items-center justify-center txt-2 shrink-0 active:scale-[0.94] transition-transform disabled:opacity-30"
                  >
                    <Icono nombre="minus" size={18} />
                  </button>
                  <span className="flex-1 text-center t-monto font-semibold tabular txt">
                    {formatBp(b.percentageBp)}
                  </span>
                  <button
                    onClick={() => cambiar(i, 'percentageBp', Math.min(10000, b.percentageBp + 100))}
                    disabled={b.percentageBp >= 10000}
                    aria-label={`Subir un punto el porcentaje de ${b.name}`}
                    className="w-11 h-11 rounded-xl superficie borde border flex items-center justify-center txt-2 shrink-0 active:scale-[0.94] transition-transform disabled:opacity-30"
                  >
                    <Icono nombre="plus" size={18} />
                  </button>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10000}
                  step={100}
                  value={b.percentageBp}
                  onChange={(e) => cambiar(i, 'percentageBp', Number(e.target.value))}
                  className="deslizador w-full"
                  style={{ ['--avance' as string]: `${b.percentageBp / 100}%`, ['--c' as string]: b.color }}
                  aria-label={`Porcentaje de ${b.name}`}
                />
              </div>
            )}

            {b.fillKind === 'fijo' && (
              <Campo
                etiqueta="Monto de cada ingreso"
                value={b.fillMinor === null ? '' : montoPlano(b.fillMinor, moneda)}
                onChange={(e) => cambiar(
                  i, 'fillMinor', parseMonto(e.target.value, moneda),
                )}
                placeholder="0.00"
                inputMode="decimal"
              />
            )}

            {b.fillKind === 'resto' && (
              <p className="t-nota txt-3 px-1 leading-relaxed">
                Se lleva lo que quede después de las demás, y absorbe el
                redondeo. Así la suma cierra al centavo cobre lo que cobre.
              </p>
            )}

            <div className="flex gap-1.5 flex-wrap">
              {COLORES.map((c) => (
                <button
                  key={c}
                  onClick={() => cambiar(i, 'color', c)}
                  aria-label={`Color ${c}`}
                  className="w-7 h-7 rounded-lg transition-transform active:scale-90"
                  style={{ background: c, outline: b.color === c ? '2px solid currentColor' : 'none' }}
                />
              ))}
            </div>

            {/* De por vida o del mes. "Ahorro largo plazo" leido de a un mes no
                significa nada, y "Diversion" acumulada desde siempre tampoco. */}
            <button
              onClick={() => cambiar(i, 'acumula', !b.acumula)}
              className="w-full flex items-center gap-2.5 text-left"
            >
              <div className={cn(
                'w-10 h-6 rounded-full p-0.5 transition-colors shrink-0',
                b.acumula ? 'bg-marca-500' : 'superficie borde border',
              )}>
                <div className={cn(
                  'w-5 h-5 rounded-full bg-white shadow transition-transform',
                  b.acumula && 'translate-x-4',
                )} />
              </div>
              <span className="t-nota txt-2 leading-snug">
                {b.acumula
                  ? 'Acumula de por vida, como un ahorro'
                  : 'Se lee por mes, como un gasto corriente'}
              </span>
            </button>
          </div>
        ))}

        <Boton
          variante="secundario"
          onClick={() => setBorradores((p) => [...p, {
            name: 'Nueva jarra', percentageBp: 0, color: COLORES[p.length % COLORES.length],
            icon: 'piggy-bank', acumula: false, fillKind: 'porcentaje', fillMinor: null,
          }])}
          className="w-full"
        >
          <Icono nombre="plus" size={17} /> Agregar jarra
        </Boton>

        <div className="flex gap-2 pt-1">
          <Boton variante="secundario" onClick={alCerrar} className="flex-1">Cancelar</Boton>
          <Boton
            onClick={async () => {
              setGuardando(true);
              // El PUT recibe la lista COMPLETA y borra lo que no venga, asi
              // que las jarras de las otras economias viajan intactas. Sin
              // esto, ajustar los frascos de la casa borraria los del negocio.
              const otras = jarras
                .filter((j) => j.entityId !== entidad)
                .map((j) => ({
                  id: j.id, name: j.name, percentageBp: j.percentageBp, color: j.color,
                  icon: j.icon, acumula: j.acumula, entityId: j.entityId,
                  fillKind: j.fillKind, fillMinor: j.fillMinor,
                }));
              const propias = borradores
                .filter((b) => b.name.trim() !== '')
                .map((b) => ({ ...b, entityId: entidad }));
              await alGuardar([...otras, ...propias]);
              setGuardando(false);
            }}
            disabled={!ok || guardando}
            className="flex-1 min-h-12"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </Boton>
        </div>

        {!ok && !motivo && (
          <p className="t-nota txt-3 text-center">
            Los porcentajes deben sumar 100% para poder repartir un ingreso.
          </p>
        )}
      </div>
    </Hoja>
  );
}

/**
 * Repartir entre las jarras plata que ya esta en las cuentas.
 *
 * Casi siempre es el capital con el que se arranco —los saldos iniciales— que
 * las jarras nunca vieron, porque solo ven movimientos. No mueve ninguna
 * cuenta: la plata ya esta ahi, lo unico que cambia es para que esta.
 */
function HojaAsignar({ abierta, alCerrar, disponible, hacia }: {
  abierta: boolean; alCerrar: () => void; disponible: number;
  /** Una jarra ya elegida, cuando se entra desde su detalle. */
  hacia?: string;
}) {
  const {
    jars, entities, entidadActiva, household, asignarAJarras, avisar,
  } = useStore();
  const moneda = household?.currency ?? 'USD';

  const [montoTexto, setMontoTexto] = useState('');
  const [destino, setDestino] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  const economias = entities.filter((e) => !e.archived);
  const porDefecto = useMemo(() => entidadPorDefecto(entities), [entities]);

  useEffect(() => {
    if (!abierta) return;
    // Todo lo disponible por defecto: es lo que se viene a hacer.
    setMontoTexto(disponible > 0 ? montoPlano(disponible, moneda) : '');
    // Si se entro desde una jarra, esa jarra ya viene elegida: nadie abre el
    // detalle de «Ahorro», toca «Poner plata» y despues quiere elegir otra.
    setDestino(hacia ?? (entidadActiva ? `e:${entidadActiva}` : `e:${porDefecto ?? ''}`));
    setNota('');
  }, [abierta, disponible, moneda, entidadActiva, porDefecto, hacia]);

  const monto = parseMonto(montoTexto, moneda);
  const esEconomia = destino.startsWith('e:');
  const economiaId = esEconomia ? destino.slice(2) : null;

  // Como caeria, con las reglas de quien recibe.
  const reparto = useMemo(() => {
    if (monto === null || monto <= 0) return [];
    if (!esEconomia) {
      const j = jars.find((x) => x.id === destino);
      return j ? [{ jarra: j, parte: monto }] : [];
    }
    const suyas = jars.filter((j) => j.entityId === economiaId);
    const partes = repartirEnJarras(monto, suyas);
    return suyas
      .map((jarra) => ({ jarra, parte: partes.get(jarra.id) ?? 0 }))
      .filter((x) => x.parte !== 0);
  }, [monto, esEconomia, economiaId, destino, jars]);

  const puede = monto !== null && monto > 0 && reparto.length > 0 && !guardando;

  async function guardar() {
    if (!puede || monto === null) return;
    setGuardando(true);
    try {
      await asignarAJarras({
        amountMinor: monto,
        jarId: esEconomia ? null : destino,
        entityId: esEconomia ? economiaId : null,
        note: nota.trim() || undefined,
      });
      alCerrar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo repartir');
    } finally {
      setGuardando(false);
    }
  }

  if (!abierta) return null;

  return (
    <Hoja abierta alCerrar={alCerrar} titulo="Repartir lo que está sin asignar">
      <div className="space-y-4">
        <Campo
          etiqueta="Monto"
          value={montoTexto}
          onChange={(e) => setMontoTexto(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
        />

        {monto !== null && monto > disponible && (
          <p className="t-nota text-amber-600 dark:text-amber-500 px-1 -mt-2 leading-relaxed">
            Sin asignar hay {formatMonto(disponible, moneda)}. Repartir más deja
            las jarras con más de lo que hay en las cuentas.
          </p>
        )}

        <Selector etiqueta="A" value={destino} onChange={(e) => setDestino(e.target.value)}>
          {economias.filter((e) => jars.some((j) => j.entityId === e.id)).map((e) => (
            <option key={e.id} value={`e:${e.id}`}>
              Repartir entre las jarras de {e.name}
            </option>
          ))}
          <optgroup label="O a una sola jarra">
            {jars.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} · {formatMonto(j.balanceMinor, moneda)}
              </option>
            ))}
          </optgroup>
        </Selector>

        {reparto.length > 0 && (
          <div className="superficie-2 rounded-2xl p-3 space-y-1.5 -mt-1">
            <p className="t-nota txt-2 mb-1.5">Queda así:</p>
            {reparto.map(({ jarra, parte }) => (
              <div key={jarra.id} className="flex items-center justify-between gap-2 t-nota">
                <span className="txt-2 truncate">{jarra.name}</span>
                <span className="tabular font-medium txt shrink-0">
                  {formatMonto(jarra.balanceMinor, moneda)} → {formatMonto(jarra.balanceMinor + parte, moneda)}
                </span>
              </div>
            ))}
          </div>
        )}

        <Campo
          etiqueta="Por qué (opcional)"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Lo que ya teníamos ahorrado..."
          maxLength={200}
        />

        <Boton onClick={() => void guardar()} disabled={!puede} className="w-full min-h-12">
          {guardando ? 'Repartiendo...' : 'Repartir'}
        </Boton>
      </div>
    </Hoja>
  );
}
