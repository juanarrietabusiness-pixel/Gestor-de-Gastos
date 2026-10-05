/**
 * Carga de un movimiento.
 *
 * La pantalla que mas se usa. Todo esta a la vista: no hay seccion plegada de
 * "mas detalles", porque esconder la fecha o la jarra hacia que nadie las
 * tocara y despues costaba entender por que los numeros no cerraban.
 *
 * El orden sigue al de la cabeza de quien carga: cuanto, en que, de donde
 * sale, a que jarra se imputa, quien lo hizo, cuando.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/store.tsx';
import { leer } from '@shared/parser';
import { formatMonto, montoPlano, parseMonto } from '@shared/money';
import {
  entidadDe, entidadPorDefecto, imputacionJarras, indexarCategorias, jarrasDe,
} from '@shared/domain';
import { esEvento, TxType, type Transaction, type TransactionInput } from '@shared/types';
import { aInputDate, deInputDate, fechaCorta, vibrar } from '../../lib/utils.ts';
import { Avatar, Boton, Campo, Ficha, Hoja, Icono, Selector } from '../ui/base.tsx';
import { cn } from '../../lib/utils.ts';

const TIPOS: { id: TxType; etiqueta: string; icono: string; color: string }[] = [
  { id: TxType.GASTO, etiqueta: 'Gasto', icono: 'arrow-down-left', color: '#ef4444' },
  { id: TxType.INGRESO, etiqueta: 'Ingreso', icono: 'arrow-up-right', color: '#10b981' },
  { id: TxType.TRANSFERENCIA, etiqueta: 'Transferencia', icono: 'arrow-left-right', color: '#3b82f6' },
];

/**
 * Nombre de cuenta con su dueño: "Banco Central · Avalon".
 *
 * Es para donde la cuenta aparece SUELTA —el detalle de un movimiento, una
 * fila— y hay que decir de quién es sin nada alrededor que lo cuente. En un
 * desplegable no: ahí el dueño es el título del grupo. Ver `cuentasPorDueno`.
 */
export function etiquetaCuenta(
  cuenta: { name: string; owner: string },
  members: { id: string; displayName: string }[],
): string {
  if (cuenta.owner === 'compartida') return `${cuenta.name} · Compartida`;
  const duenio = members.find((m) => m.id === cuenta.owner);
  return duenio ? `${cuenta.name} · ${duenio.displayName}` : cuenta.name;
}

/**
 * Las cuentas agrupadas por dueño, como las jarras y las categorías por
 * economía.
 *
 * En una lista plana cada renglón tenía que repetir de quién era —"BG
 * principal · Abrinay", "BG ahorros · Abrinay", "BG principal · Avalon"— y con
 * seis cuentas eso son seis veces el mismo par de nombres. El ojo termina
 * leyendo la parte que cambia dos palabras adentro del renglón, que es justo
 * al revés de como se busca: primero de quién, después cuál.
 *
 * Con el dueño de título, el nombre de la cuenta vuelve al principio del
 * renglón y al lado le queda su saldo, que es el dato por el que se elige.
 *
 * El orden: primero las compartidas —son las de la casa, y la app preselecciona
 * la primera de la lista—, después cada persona en el orden en que aparece en
 * todas las demás pantallas, y al final las que quedaron sin dueño, que son las
 * que hay que arreglar.
 */
export function cuentasPorDueno<C extends { id: string; owner: string }>(
  cuentas: C[],
  members: { id: string; displayName: string }[],
): { clave: string; nombre: string; cuentas: C[] }[] {
  const grupos: { clave: string; nombre: string; cuentas: C[] }[] = [];

  const meter = (clave: string, nombre: string, lista: C[]) => {
    if (lista.length > 0) grupos.push({ clave, nombre, cuentas: lista });
  };

  meter('compartida', 'Compartidas', cuentas.filter((c) => c.owner === 'compartida'));
  for (const m of members) {
    meter(m.id, m.displayName, cuentas.filter((c) => c.owner === m.id));
  }
  meter(
    'sin-dueno',
    'Sin dueño',
    cuentas.filter((c) => c.owner !== 'compartida' && !members.some((m) => m.id === c.owner)),
  );

  return grupos;
}

export function CargaRapida({ abierta, alCerrar, editando }: {
  abierta: boolean;
  alCerrar: () => void;
  editando?: Transaction | null;
}) {
  const {
    accounts, categories, jars, entities, entidadActiva, transactions, members, me,
    household, budgets, guardarTx,
  } = useStore();
  const moneda = household?.currency ?? 'USD';

  const activas = useMemo(() => accounts.filter((c) => !c.archived), [accounts]);

  const [frase, setFrase] = useState('');
  const [tipo, setTipo] = useState<TxType>(TxType.GASTO);
  const [montoTexto, setMontoTexto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [accountId, setAccountId] = useState('');
  const [destAccountId, setDestAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [jarId, setJarId] = useState('');
  const [budgetId, setBudgetId] = useState('');
  const [paidBy, setPaidBy] = useState('');
  // Encendido por defecto. Estuvo apagado los primeros 44 movimientos y no lo
  // prendio nadie: las jarras solo veian gastos y quedaban en rojo. Un ingreso
  // que no se reparte es la excepcion, no la regla.
  const [repartir, setRepartir] = useState(false);
  const [fecha, setFecha] = useState(aInputDate(Date.now()));
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La fecha empieza plegada: casi siempre es hoy.
  const [fechaAbierta, setFechaAbierta] = useState(false);

  const refFrase = useRef<HTMLInputElement>(null);
  const refMonto = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!abierta) return;

    if (editando) {
      setTipo(editando.type);
      setMontoTexto(montoPlano(Math.abs(editando.amountMinor), moneda));
      setDescripcion(editando.description);
      setAccountId(editando.accountId);
      setDestAccountId(editando.destAccountId ?? '');
      setCategoryId(editando.categoryId ?? '');
      setJarId(editando.jarId ?? '');
      setBudgetId(editando.budgetId ?? '');
      setPaidBy(editando.paidBy ?? editando.createdBy);
      setRepartir(editando.distributeToJars);
      setFecha(aInputDate(editando.date));
      setNotas(editando.notes ?? '');
      setFrase('');
    } else {
      setTipo(TxType.GASTO);
      setMontoTexto('');
      setDescripcion('');
      setAccountId(activas[0]?.id ?? '');
      setDestAccountId('');
      setCategoryId('');
      setJarId('');
      setBudgetId('');
      // Un movimiento nuevo arranca como gasto, y un gasto no se reparte.
      // Al pasar a Ingreso se prende solo, abajo.
      setPaidBy(me?.id ?? '');
      setRepartir(false);
      setFecha(aInputDate(Date.now()));
      setNotas('');
      setFrase('');
    }
    // En un movimiento nuevo el foco va al monto, que es lo primero que se
    // teclea. `inputMode="decimal"` hace que el telefono abra el teclado
    // numerico solo, sin que haya que dibujar ninguno.
    if (!editando) setTimeout(() => refMonto.current?.focus(), 120);
    setFechaAbierta(false);
    setError(null);
  }, [abierta, editando, moneda, activas, me]);

  const lectura = useMemo(() => {
    if (!frase.trim() || editando) return null;
    return leer(frase, { categories, historial: transactions, currency: moneda });
  }, [frase, categories, transactions, moneda, editando]);

  useEffect(() => {
    if (!lectura) return;
    if (lectura.amountMinor !== null) setMontoTexto(montoPlano(lectura.amountMinor, moneda));
    setDescripcion(lectura.description);
    setTipo(lectura.type);
    if (lectura.categoryId) setCategoryId(lectura.categoryId);
  }, [lectura, moneda]);

  const montoMinor = parseMonto(montoTexto, moneda);
  const esTransferencia = tipo === TxType.TRANSFERENCIA;
  const tipoCategoria = tipo === TxType.INGRESO ? 'ingreso' : 'gasto';

  // Ordenadas por economia, y primero las de la que se esta mirando: si estan
  // en PanaClaw, las de PanaClaw arriba.
  const categoriasVisibles = useMemo(() => {
    const orden = new Map(entities.map((e) => [e.id, e.displayOrder]));
    return categories
      .filter((c) => !c.archived && c.type === tipoCategoria)
      .sort((a, b) => {
        if (a.entityId !== b.entityId) {
          if (a.entityId === entidadActiva) return -1;
          if (b.entityId === entidadActiva) return 1;
          return (orden.get(a.entityId ?? '') ?? 999) - (orden.get(b.entityId ?? '') ?? 999);
        }
        return a.displayOrder - b.displayOrder;
      });
  }, [categories, tipoCategoria, entities, entidadActiva]);

  const cuentaSel = activas.find((c) => c.id === accountId);

  /** Las cuentas del desplegable, agrupadas por dueño. */
  const cuentasDesde = useMemo(() => cuentasPorDueno(activas, members), [activas, members]);
  const cuentasHacia = useMemo(
    () => cuentasPorDueno(activas.filter((c) => c.id !== accountId), members),
    [activas, members, accountId],
  );

  const puedeGuardar =
    montoMinor !== null && montoMinor > 0 &&
    accountId !== '' &&
    (!esTransferencia || (destAccountId !== '' && destAccountId !== accountId)) &&
    !guardando;

  /**
   * Las jarras que reparten ESTE movimiento: las de su economia, que sale de
   * la categoria elegida. Un cobro de PanaClaw no cae en los frascos de la
   * casa.
   */
  const jarrasPropias = useMemo(() => {
    const suya = entidadDe(
      { entityId: editando?.entityId ?? null, categoryId: categoryId || null },
      indexarCategorias(categories),
    );
    return jarrasDe(jars, suya, entidadPorDefecto(entities));
  }, [jars, categories, entities, categoryId, editando]);

  /** Las categorias visibles, agrupadas por economia para el desplegable. */
  const categoriasPorEconomia = useMemo(() => {
    const grupos: { id: string | null; nombre: string; categorias: typeof categories }[] = [];
    for (const c of categoriasVisibles) {
      const clave = c.entityId;
      let g = grupos.find((x) => x.id === clave);
      if (!g) {
        g = {
          id: clave,
          nombre: entities.find((e) => e.id === clave)?.name ?? 'Sin economía',
          categorias: [],
        };
        grupos.push(g);
      }
      g.categorias.push(c);
    }
    return grupos;
  }, [categoriasVisibles, entities]);

  /**
   * Las jarras agrupadas por economia, con la de este movimiento primero.
   *
   * Es lo que se va a elegir el 99% de las veces; las otras quedan abajo y
   * con su nombre, porque sacar plata de los impuestos de un negocio para
   * pagar la comida se puede, pero tiene que costar un scroll y verse escrito
   * de quien es.
   */
  const economiasConJarras = useMemo(() => {
    const nombreDe = (id: string | null) =>
      entities.find((x) => x.id === id)?.name ?? 'Sin economía';

    const suya = jarrasPropias[0]?.entityId ?? null;
    const grupos: { id: string | null; nombre: string; jarras: typeof jars }[] = [];

    if (jarrasPropias.length > 0) {
      grupos.push({ id: suya, nombre: nombreDe(suya), jarras: jarrasPropias });
    }
    for (const e of entities) {
      if (e.id === suya) continue;
      const suyas = jars.filter((j) => j.entityId === e.id);
      if (suyas.length > 0) grupos.push({ id: e.id, nombre: e.name, jarras: suyas });
    }
    return grupos;
  }, [jars, entities, jarrasPropias]);

  /** A donde iria a parar el ingreso si se guarda asi. */
  const vistaPrevia = useMemo(() => {
    if (!repartir || tipo !== TxType.INGRESO || montoMinor === null || montoMinor <= 0) return [];
    const partes = imputacionJarras(
      { type: TxType.INGRESO, amountMinor: montoMinor, distributeToJars: true, jarId: null },
      jarrasPropias,
    );
    return jarrasPropias
      .map((jarra) => ({ jarra, monto: partes.get(jarra.id) ?? 0 }))
      .filter((x) => x.monto !== 0);
  }, [repartir, tipo, montoMinor, jarrasPropias]);

  /**
   * La jarra que suelen usar con esta categoria.
   *
   * Se mira el historial y gana la mas usada de los ultimos movimientos de esa
   * categoria. Asi el caso normal es confirmar, no elegir: el campo viene con
   * la respuesta puesta y solo se toca cuando ese dia fue distinto.
   */
  const jarraPorCostumbre = useMemo(() => {
    if (!categoryId) return '';
    const cuenta = new Map<string, number>();
    for (const t of transactions) {
      if (t.categoryId !== categoryId || !t.jarId) continue;
      cuenta.set(t.jarId, (cuenta.get(t.jarId) ?? 0) + 1);
      if (cuenta.size > 0 && t.date < Date.now() - 180 * 86_400_000) break;
    }
    let mejor = '';
    let masVeces = 0;
    for (const [id, veces] of cuenta) {
      if (veces > masVeces && jarrasPropias.some((j) => j.id === id)) {
        mejor = id;
        masVeces = veces;
      }
    }
    return mejor;
  }, [categoryId, transactions, jarrasPropias]);

  // Al elegir categoria se propone su jarra de siempre, si todavia no hay una
  // puesta a mano. Nunca pisa una eleccion explicita.
  useEffect(() => {
    if (tipo !== TxType.GASTO || jarId || !jarraPorCostumbre) return;
    setJarId(jarraPorCostumbre);
  }, [tipo, jarId, jarraPorCostumbre]);

  // Si la categoria cambio de economia, la jarra elegida puede ya no
  // pertenecerle. Se suelta en vez de guardar un gasto en la jarra de otro.
  useEffect(() => {
    if (jarId && !jarrasPropias.some((j) => j.id === jarId)) setJarId('');
  }, [jarId, jarrasPropias]);

  /**
   * Los presupuestos de evento abiertos.
   *
   * Solo se ofrecen en un gasto: un ingreso no consume un tope. Y solo los
   * abiertos: cerrar un evento es justamente dejar de que se le carguen cosas.
   */
  const eventosAbiertos = useMemo(
    () => budgets.filter((b) => esEvento(b) && !b.closedAt),
    [budgets],
  );

  /** Si este gasto deja la jarra en rojo, cuanto queda. */
  const sobregiro = useMemo(() => {
    if (tipo !== TxType.GASTO || !jarId || montoMinor === null || montoMinor <= 0) return null;
    const jarra = jars.find((j) => j.id === jarId);
    if (!jarra) return null;
    // Al editar, el efecto viejo ya esta contado en el saldo: se descuenta
    // para no avisar de un sobregiro que en realidad no cambia.
    const yaContado = editando?.jarId === jarId && editando.type === TxType.GASTO
      ? editando.amountMinor : 0;
    const queda = jarra.balanceMinor + yaContado - montoMinor;
    return queda < 0 ? { jarra, queda } : null;
  }, [tipo, jarId, montoMinor, jars, editando]);

  async function guardar() {
    if (!puedeGuardar || montoMinor === null) return;
    setGuardando(true);
    setError(null);

    const entrada: TransactionInput = {
      type: tipo,
      amountMinor: montoMinor,
      accountId,
      destAccountId: esTransferencia ? destAccountId : null,
      destAmountMinor: null,
      categoryId: esTransferencia ? null : (categoryId || null),
      // Un gasto sale de una jarra; un ingreso va a una sola si no se
      // reparte; una transferencia no toca ninguna.
      jarId: !esTransferencia && !repartir ? (jarId || null) : null,
      budgetId: tipo === TxType.GASTO ? (budgetId || null) : null,
      distributeToJars: tipo === TxType.INGRESO && repartir,
      description: descripcion.trim() || 'Movimiento',
      notes: notas.trim() || null,
      date: deInputDate(fecha),
      // Solo se manda si difiere de quien lo carga: null quiere decir
      // "el mismo", y guardarlo asi mantiene los datos limpios.
      paidBy: paidBy && paidBy !== me?.id ? paidBy : null,
      recurringId: editando?.recurringId ?? null,
      // Null = la de su categoria, que es el caso normal. Solo se escribe al
      // corregir uno suelto desde el detalle.
      entityId: editando?.entityId ?? null,
    };

    try {
      await guardarTx(entrada, editando?.id);
      vibrar();
      alCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Hoja
      abierta={abierta}
      alCerrar={alCerrar}
      titulo={editando ? 'Editar movimiento' : 'Nuevo movimiento'}
      /* Guardar al pie y siempre visible. Antes vivia al final del formulario:
         en pantalla completa, con el teclado abierto y quince controles arriba,
         habia que recorrer todo para abajo para poder guardar. */
      pie={(
        <Boton onClick={() => void guardar()} disabled={!puedeGuardar} className="w-full min-h-12">
          {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Registrar'}
        </Boton>
      )}
    >
      <div className="space-y-4">
        {!editando && (
          <div>
            <div className="relative">
              <Campo
                ref={refFrase}
                value={frase}
                onChange={(e) => setFrase(e.target.value)}
                placeholder='Escribe "super 12500" y listo'
                inputMode="text"
                enterKeyHint="done"
                className="pr-10"
              />
              <Icono
                nombre="wand-sparkles"
                size={17}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 txt-3 pointer-events-none"
              />
            </div>
            {lectura && lectura.razon !== 'ninguna' && (
              <p className="t-nota txt-3 mt-1.5 px-1">
                {lectura.razon === 'historial'
                  ? 'Categoría sugerida por movimientos parecidos tuyos'
                  : 'Categoría sugerida por la descripción'}
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {TIPOS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTipo(t.id);
                // Un ingreso se reparte salvo que digan lo contrario; un gasto
                // sale de UNA jarra y una transferencia no toca ninguna.
                setRepartir(t.id === TxType.INGRESO);
                if (t.id !== TxType.GASTO) setJarId('');
              }}
              /* Icono arriba y texto abajo. En una fila, a 390px el tercero
                 quedaba en «Transferen...»: el icono se comia el ancho que
                 necesitaba la palabra mas larga de las tres. */
              className={cn(
                'min-h-14 rounded-xl t-nota font-medium border transition-all',
                'flex flex-col items-center justify-center gap-0.5 px-1',
                tipo === t.id ? 'text-white border-transparent' : 'superficie-2 borde txt-2',
              )}
              style={tipo === t.id ? { background: t.color } : undefined}
            >
              <Icono nombre={t.icono} size={16} />
              <span className="truncate max-w-full">{t.etiqueta}</span>
            </button>
          ))}
        </div>

        <div>
          <span className="block t-nota font-medium txt-2 mb-1.5">Monto</span>
          <input
            ref={refMonto}
            value={montoTexto}
            onChange={(e) => setMontoTexto(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            aria-label="Monto"
            className={cn(
              'w-full min-w-0 min-h-16 px-4 rounded-2xl superficie-2 borde border txt',
              't-cifra font-semibold tabular text-center outline-none',
              'focus:border-marca-500 focus:ring-2 focus:ring-marca-500/20',
            )}
          />
          {montoMinor !== null && montoMinor > 0 && (
            <p className="t-nota txt-3 mt-1.5 text-center">{formatMonto(montoMinor, moneda)}</p>
          )}
        </div>

        <Campo
          etiqueta="Descripción"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="En qué fue"
        />

        {!esTransferencia && categoriasVisibles.length > 0 && (
          /* Un desplegable, igual que cuenta y jarra. La fila de fichas se veia
             bien con seis categorias; con treinta hay que arrastrar a ciegas
             buscando una, y las de las otras economias quedan siempre al final
             del recorrido. Un `select` las agrupa por economia y el telefono
             lo dibuja a pantalla completa. */
          <Selector
            etiqueta="Categoría"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Sin categoría</option>
            {categoriasPorEconomia.map((g) => (
              <optgroup key={g.id ?? 'sueltas'} label={g.nombre}>
                {g.categorias.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
            ))}
          </Selector>
        )}

        {/* Cuenta, y justo debajo la jarra: el dinero sale de una cuenta y se
            imputa a una jarra, asi que van juntos y en ese orden.

            Agrupadas por dueño, igual que las categorías y las jarras por
            economía: el nombre de la persona va UNA vez, de título, y cada
            renglón queda con lo que de verdad lo distingue —la cuenta y su
            saldo— en vez de repetir «· Abrinay» seis veces. */}
        <Selector
          etiqueta={esTransferencia ? 'Desde' : 'Cuenta'}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Elige una cuenta</option>
          {cuentasDesde.map((g) => (
            <optgroup key={g.clave} label={g.nombre}>
              {g.cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {formatMonto(c.balanceMinor, c.currency, { compacto: true })}
                </option>
              ))}
            </optgroup>
          ))}
        </Selector>

        {esTransferencia && (
          <Selector etiqueta="Hacia" value={destAccountId} onChange={(e) => setDestAccountId(e.target.value)}>
            <option value="">Elige una cuenta</option>
            {cuentasHacia.map((g) => (
              <optgroup key={g.clave} label={g.nombre}>
                {g.cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {formatMonto(c.balanceMinor, c.currency, { compacto: true })}
                  </option>
                ))}
              </optgroup>
            ))}
          </Selector>
        )}

        {/* Las de su economia primero, que es lo que se va a elegir el 99% de
            las veces. Las otras quedan abajo y agrupadas: sacar plata de los
            impuestos de un negocio para pagar la comida se puede, pero tiene
            que costar un scroll y verse escrito de quien es. */}
        {/* De que jarra sale.
            `repartir` significa ahora lo que dice —repartir un INGRESO entre
            varias jarras— y por eso arranca apagado y se enciende solo al
            elegir Ingreso. Antes arrancaba encendido incluso en un gasto, y
            como su interruptor solo se dibuja para los ingresos, en un gasto
            nuevo este campo no aparecia nunca... salvo que tocaras el chip de
            «Gasto», que ya estaba elegido. Segun si lo tocabas o no, el mismo
            gasto se guardaba con jarra o sin ella. */}
        {!esTransferencia && !repartir && jars.length > 0 && (
          <Selector etiqueta="Jarra" value={jarId} onChange={(e) => setJarId(e.target.value)}>
            <option value="">Sin jarra</option>
            {/* TODOS los grupos dicen de qué economía son, el primero
                incluido. Antes las de la economía actual iban sueltas y sin
                título, y las otras sí con el suyo: la lista decía «PanaClaw»
                y «BukoFlow» pero se callaba que las de arriba eran de la
                familia, así que parecía que faltaba una. */}
            {economiasConJarras.map((e) => (
              <optgroup key={e.id ?? 'sueltas'} label={e.nombre}>
                {e.jarras.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name} · {formatMonto(j.balanceMinor, moneda, { compacto: true })}
                  </option>
                ))}
              </optgroup>
            ))}
          </Selector>
        )}

        {/* Gastar de una jarra vacia es la senal que un sistema de sobres
            existe para dar. No lo impide (a veces te pasaste y ya esta), pero
            lo dice ANTES de guardar, no despues en otra pantalla. */}
        {sobregiro && (
          <div className="-mt-2 rounded-2xl p-3 border"
            style={{ borderColor: '#f59e0b66', background: '#f59e0b14' }}>
            <p className="t-nota txt-2 leading-relaxed">
              <span className="font-semibold txt">{sobregiro.jarra.name}</span> queda en{' '}
              <span className="font-semibold tabular text-red-500">
                {formatMonto(sobregiro.queda, moneda)}
              </span>.
              {' '}Se guarda igual; después puedes moverle plata desde otra jarra.
            </p>
          </div>
        )}

        {/* El reparto, calculado en vivo. Hasta ahora habia que guardar para
            enterarse de a donde iba a parar la plata. */}
        {repartir && montoMinor !== null && montoMinor > 0 && vistaPrevia.length > 0 && (
          <div className="-mt-2 rounded-2xl superficie-2 borde border p-3 space-y-1">
            {vistaPrevia.map(({ jarra, monto }) => (
              <div key={jarra.id} className="flex items-center justify-between gap-2 t-nota">
                <span className="txt-2 truncate">{jarra.name}</span>
                <span className="tabular font-medium txt shrink-0">
                  {formatMonto(monto, moneda)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Solo si la economia de este movimiento tiene jarras. Si PanaClaw
            todavia no reparte, el interruptor seria un boton que no hace
            nada. */}
        {/* ¿Es de algún evento? Solo aparece si hay uno abierto: sin eventos
            el formulario no se entera de que existen. */}
        {tipo === TxType.GASTO && eventosAbiertos.length > 0 && (
          <div>
            <span className="block t-nota font-medium txt-2 mb-2">¿Es de algún presupuesto?</span>
            <div className="flex gap-2 overflow-x-auto sin-barra pb-1">
              {eventosAbiertos.map((b) => {
                const elegido = budgetId === b.id;
                return (
                  <button
                    key={b.id}
                    onClick={() => setBudgetId(elegido ? '' : b.id)}
                    className={cn(
                      'shrink-0 min-h-11 px-3 rounded-xl border t-fila font-medium flex items-center gap-1.5 transition-all',
                      elegido
                        ? 'bg-marca-600 text-white border-transparent'
                        : 'superficie-2 borde txt-2',
                    )}
                  >
                    <Icono nombre={elegido ? 'check' : 'scale'} size={15} />
                    {b.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tipo === TxType.INGRESO && jarrasPropias.length > 0 && (
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
                {montoMinor
                  ? `Se reparten ${formatMonto(montoMinor, moneda)} según los porcentajes`
                  : 'Según los porcentajes de cada jarra'}
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

        {/* Quién lo hizo. Solo aparece si son dos o mas: con una sola persona
            la pregunta no tiene sentido. */}
        {members.length > 1 && !esTransferencia && (
          <div>
            <span className="block t-nota font-medium txt-2 mb-2">Quién lo hizo</span>
            <div className="flex gap-2">
              {members.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setPaidBy(m.id)}
                  className={cn(
                    'flex-1 min-h-12 rounded-xl border flex items-center justify-center gap-2 px-2 transition-all',
                    paidBy === m.id ? 'border-transparent' : 'superficie-2 borde',
                  )}
                  style={paidBy === m.id ? { background: `${m.color}1f`, boxShadow: `0 0 0 2px ${m.color}` } : undefined}
                >
                  <Avatar nombre={m.displayName} color={m.color} emoji={m.emoji} size={26} />
                  <span className={cn('t-fila font-medium truncate', paidBy === m.id ? 'txt' : 'txt-2')}>
                    {m.displayName}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* La fecha, plegada. El campo `date` nativo abre su calendario dentro
            del formulario y se sale del ancho; casi siempre es hoy, así que se
            muestra escrita y solo se despliega si hay que cambiarla. */}
        <div>
          <span className="block t-nota font-medium txt-2 mb-1.5">Fecha</span>
          {fechaAbierta ? (
            <Campo
              type="date"
              value={fecha}
              autoFocus
              onChange={(e) => setFecha(e.target.value)}
              onBlur={() => setFechaAbierta(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setFechaAbierta(true)}
              className="w-full min-h-11 px-3.5 rounded-2xl superficie-2 borde border txt t-campo text-left flex items-center justify-between gap-2"
            >
              <span className="truncate">{fechaCorta(deInputDate(fecha))}</span>
              <Icono nombre="calendar-days" size={17} className="txt-3 shrink-0" />
            </button>
          )}
        </div>

        <Campo
          etiqueta="Notas"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Opcional"
        />

        {cuentaSel && montoMinor !== null && montoMinor > 0 && tipo === TxType.GASTO && (
          <p className="t-nota txt-3 text-center">
            Saldo después: {formatMonto(cuentaSel.balanceMinor - montoMinor, cuentaSel.currency)}
          </p>
        )}

        {error && <p className="t-fila text-red-500 text-center px-2">{error}</p>}
      </div>
    </Hoja>
  );
}
