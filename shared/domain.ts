/**
 * Motor de calculo. Funciones puras, sin red ni estado: el cliente y el Worker
 * usan exactamente las mismas, asi que lo que ves en pantalla al instante
 * (actualizacion optimista) y lo que confirma el servidor no pueden diferir.
 */

import {
  type Account, type Budget, type Category, type Entity, type Jar, type JarAporte,
  type JarImputacion, type JarTransfer, type Member, type Transaction, TxType,
  esEvento,
} from './types.ts';
import { repartir, sumarMinor } from './money.ts';
import { dentroDe, type Periodo } from './periodo.ts';

// ---------------------------------------------------------------------------
// Saldos de cuenta
// ---------------------------------------------------------------------------

/**
 * Cuanto mueve una transaccion el saldo de una cuenta dada.
 * Devuelve 0 si la transaccion no toca esa cuenta.
 *
 * El signo se decide aca y en un solo lugar. La version anterior repetia esta
 * logica cuatro veces (alta, baja, edicion y reversa) y bastaba con que una
 * copia se desincronizara para corromper saldos.
 */
export function efectoEnCuenta(tx: Transaction, accountId: string): number {
  switch (tx.type) {
    case TxType.INGRESO:
      return tx.accountId === accountId ? tx.amountMinor : 0;

    case TxType.GASTO:
      return tx.accountId === accountId ? -tx.amountMinor : 0;

    case TxType.AJUSTE:
      // Un ajuste puede ser en cualquier direccion, por eso guarda su signo.
      return tx.accountId === accountId ? tx.amountMinor : 0;

    case TxType.TRANSFERENCIA: {
      let efecto = 0;
      if (tx.accountId === accountId) efecto -= tx.amountMinor;
      if (tx.destAccountId === accountId) {
        efecto += tx.destAmountMinor ?? tx.amountMinor;
      }
      return efecto;
    }

    default:
      return 0;
  }
}

/** Saldo real de cada cuenta: saldo inicial + todos sus movimientos. */
export function calcularSaldos(
  accounts: Account[],
  transactions: Transaction[],
): Map<string, number> {
  const saldos = new Map<string, number>();
  for (const a of accounts) saldos.set(a.id, a.initialBalanceMinor);

  for (const tx of transactions) {
    for (const id of [tx.accountId, tx.destAccountId]) {
      if (!id || !saldos.has(id)) continue;
      const efecto = efectoEnCuenta(tx, id);
      if (efecto !== 0) saldos.set(id, saldos.get(id)! + efecto);
    }
  }
  return saldos;
}

/**
 * Patrimonio neto: la suma de todos los saldos.
 *
 * El signo ya vive en el saldo, no se aplica aca. Un gasto siempre resta del
 * saldo de su cuenta, tambien en una tarjeta de credito: consumir 450 deja la
 * tarjeta en -450, que es exactamente lo que hay que sumar al patrimonio.
 *
 * Esto estaba mal y el error valia plata: se restaba `-balanceMinor` para los
 * pasivos, o sea que a un saldo ya negativo se le daba vuelta el signo otra
 * vez y la deuda terminaba SUMANDO al patrimonio. Con la tarjeta a -450 el
 * patrimonio salia 450 mas alto de lo real.
 *
 * `esActivo` sigue existiendo, pero para agrupar en pantalla ("lo que tenes" /
 * "lo que debes"), no para hacer cuentas.
 */
export function calcularPatrimonio(accounts: Account[]): number {
  return accounts.reduce(
    (total, a) => (a.archived ? total : total + a.balanceMinor),
    0,
  );
}

// ---------------------------------------------------------------------------
// Jarras
// ---------------------------------------------------------------------------

/**
 * Como se reparte un ingreso entre las jarras, o a que jarra va un movimiento.
 * Devuelve un mapa jarraId -> centavos (positivos entran, negativos salen).
 *
 * Esto se calcula UNA sola vez, al guardar el movimiento, y el resultado queda
 * escrito en jar_imputacion. Antes se recalculaba en cada lectura con los
 * porcentajes vigentes, asi que subir el ahorro del 10% al 20% reescribia el
 * sueldo de enero. Ahora cambiar un porcentaje solo afecta lo que venga
 * despues.
 *
 * Usa `repartir`, que garantiza que la suma de las partes sea exactamente el
 * total. Ver la explicacion del metodo del mayor resto en money.ts.
 */
/**
 * Como se reparte un monto entre las jarras de una entidad.
 *
 * Tres formas de llenar una jarra, porque una casa y un negocio no reparten
 * igual. Los frascos de la casa van por porcentaje: el ingreso es parejo. Un
 * cobro de agencia va de $50 a $5.000, y ahi "$100 de publicidad" tiene mas
 * sentido como monto fijo que como porcentaje.
 *
 * El orden importa y es este:
 *
 *   1. Los porcentajes, sobre el monto BRUTO. "20% de impuestos" tiene que ser
 *      el 20% de lo que se cobro, no de lo que quedo despues de otras cosas.
 *   2. Los fijos, cada uno hasta donde alcance. Si el cobro fue chico, el
 *      primero se lleva lo que hay y los siguientes quedan en cero.
 *   3. La jarra de resto, con lo que sobre.
 *
 * Asi la suma da SIEMPRE el total exacto y ninguna jarra recibe un negativo.
 * Con todas en porcentaje sumando 100% el resultado es identico al de antes.
 */
export function repartirEnJarras(totalMinor: number, jars: Jar[]): Map<string, number> {
  const out = new Map<string, number>();
  if (jars.length === 0 || totalMinor === 0) return out;

  const ordenadas = [...jars].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id),
  );
  const porcentaje = ordenadas.filter((j) => j.fillKind === 'porcentaje');
  const fijas = ordenadas.filter((j) => j.fillKind === 'fijo');
  const resto = ordenadas.find((j) => j.fillKind === 'resto');

  // El caso clasico y el mas comun: todas por porcentaje, sumando 100%. Se
  // usa el metodo del mayor resto, que reparte el total exacto sin perder
  // centavos. Ver money.ts.
  if (!resto && fijas.length === 0) {
    const partes = repartir(totalMinor, porcentaje.map((j) => j.percentageBp));
    porcentaje.forEach((j, i) => {
      if (partes[i] !== 0) out.set(j.id, partes[i]);
    });
    return out;
  }

  let libre = totalMinor;

  // 1. Porcentajes sobre el bruto.
  //
  //    Aca NO sirve `repartir`: esa funcion reparte el total entero entre los
  //    pesos que recibe, asi que con una sola jarra al 20% le daria el 100%.
  //    Sirve cuando los pesos son el reparto completo, y con una jarra de
  //    resto no lo son. Cada una toma su parte por separado y el redondeo lo
  //    absorbe el resto, que es su trabajo.
  for (const j of porcentaje) {
    const toma = Math.floor((totalMinor * j.percentageBp) / 10_000);
    if (toma !== 0) out.set(j.id, toma);
    libre -= toma;
  }

  // 2. Fijos, hasta donde alcance.
  for (const j of fijas) {
    if (libre <= 0) break;
    const toma = Math.min(j.fillMinor ?? 0, libre);
    if (toma > 0) {
      out.set(j.id, (out.get(j.id) ?? 0) + toma);
      libre -= toma;
    }
  }

  // 3. Lo que sobre. Sin jarra de resto, la diferencia queda sin asignar, que
  //    es visible en la pantalla de jarras y no se pierde en ningun lado.
  if (resto && libre !== 0) out.set(resto.id, (out.get(resto.id) ?? 0) + libre);

  return out;
}

/**
 * Como se reparte un ingreso entre las jarras, o a que jarra va un movimiento.
 * Devuelve un mapa jarraId -> centavos (positivos entran, negativos salen).
 *
 * Esto se calcula UNA sola vez, al guardar el movimiento, y el resultado queda
 * escrito en jar_imputacion. Antes se recalculaba en cada lectura con los
 * porcentajes vigentes, asi que subir el ahorro del 10% al 20% reescribia el
 * sueldo de enero. Ahora cambiar un porcentaje solo afecta lo que venga
 * despues.
 */
export function imputacionJarras(
  tx: Pick<Transaction, 'type' | 'amountMinor' | 'distributeToJars' | 'jarId'>,
  jars: Jar[],
): Map<string, number> {
  if (tx.type === TxType.INGRESO && tx.distributeToJars) {
    return repartirEnJarras(tx.amountMinor, jars);
  }

  const out = new Map<string, number>();
  if (!tx.jarId) return out;

  if (tx.type === TxType.GASTO) out.set(tx.jarId, -tx.amountMinor);
  else if (tx.type === TxType.INGRESO) out.set(tx.jarId, tx.amountMinor);

  return out;
}

/**
 * Saldo de cada jarra: la suma de sus imputaciones mas los traspasos.
 *
 * `periodo` acota que se cuenta. Sin periodo es el saldo de toda la vida, que
 * es el que cuadra contra las cuentas y el que decide si una jarra esta en
 * rojo. Con periodo es la lectura del mes.
 *
 * Ojo con la diferencia: leer por mes NO borra lo que sobro del mes anterior.
 * La plata sigue en la jarra; lo unico que cambia es que numero se mira.
 */
export function calcularJarras(
  jars: Jar[],
  imputaciones: JarImputacion[],
  transfers: JarTransfer[],
  /**
   * Obligatorio y ANTES de los opcionales a proposito. Cuando tenia un `= []`
   * al final, tres de los cuatro lugares que llamaban a estas funciones se lo
   * olvidaban y el numero salia mal sin que nada avisara: la pantalla de
   * jarras mostraba "entro $200, salio $559" en una jarra con $150 adentro, y
   * el resumen que lee el consejero le pasaba esos mismos numeros rotos.
   * Siendo obligatorio, olvidarselo no compila.
   */
  aportes: JarAporte[],
  fechaDe?: (txId: string) => number | undefined,
  periodo?: Periodo,
): Map<string, number> {
  const saldos = new Map<string, number>(jars.map((j) => [j.id, 0]));
  const suma = (jarId: string, delta: number) => {
    const actual = saldos.get(jarId);
    if (actual !== undefined) saldos.set(jarId, actual + delta);
  };

  for (const i of imputaciones) {
    if (periodo) {
      const fecha = fechaDe?.(i.txId);
      // Una imputacion sin movimiento a la vista no se puede ubicar en el
      // tiempo: se deja afuera del periodo en vez de contarla en el mes que no
      // es. En el saldo de toda la vida si entra.
      if (fecha === undefined || !dentroDe(fecha, periodo)) continue;
    }
    suma(i.jarId, i.amountMinor);
  }

  for (const t of transfers) {
    if (periodo && !dentroDe(t.date, periodo)) continue;
    suma(t.fromJarId, -t.amountMinor);
    suma(t.toJarId, t.amountMinor);
  }

  // Lo asignado a mano desde el sin asignar: no vino de ningun movimiento, y
  // por eso sube el saldo de la jarra sin tocar ninguna cuenta.
  for (const a of aportes) {
    if (periodo && !dentroDe(a.date, periodo)) continue;
    suma(a.jarId, a.amountMinor);
  }

  return saldos;
}

/** Cuanto entro y cuanto salio de una jarra, para leer el mes. */
export interface FlujoJarra {
  entroMinor: number;
  salioMinor: number;
}

export function flujoDeJarras(
  jars: Jar[],
  imputaciones: JarImputacion[],
  transfers: JarTransfer[],
  /** Obligatorio: ver la nota en calcularJarras. */
  aportes: JarAporte[],
  fechaDe?: (txId: string) => number | undefined,
  periodo?: Periodo,
): Map<string, FlujoJarra> {
  const out = new Map<string, FlujoJarra>(jars.map((j) => [j.id, { entroMinor: 0, salioMinor: 0 }]));
  const anotar = (jarId: string, delta: number) => {
    const f = out.get(jarId);
    if (!f) return;
    if (delta >= 0) f.entroMinor += delta;
    else f.salioMinor += -delta;
  };

  for (const i of imputaciones) {
    if (periodo) {
      const fecha = fechaDe?.(i.txId);
      if (fecha === undefined || !dentroDe(fecha, periodo)) continue;
    }
    anotar(i.jarId, i.amountMinor);
  }
  for (const t of transfers) {
    if (periodo && !dentroDe(t.date, periodo)) continue;
    anotar(t.fromJarId, -t.amountMinor);
    anotar(t.toJarId, t.amountMinor);
  }

  for (const a of aportes) {
    if (periodo && !dentroDe(a.date, periodo)) continue;
    anotar(a.jarId, a.amountMinor);
  }

  return out;
}

/**
 * La plata que existe y todavia no tiene trabajo asignado.
 *
 * No es una tabla ni un saldo guardado: es una resta, calculada al leer, igual
 * que el saldo de una cuenta. Por ser una resta no puede desincronizarse.
 *
 * Con esto las jarras y las cuentas dejan de ser dos libros paralelos:
 *
 *     jarras + sin asignar = la plata que hay de verdad
 *
 * Un ingreso repartido sube las jarras y no lo mueve. Uno sin repartir lo
 * sube. Un gasto sin jarra lo baja. Si queda negativo, asignaron mas de lo que
 * tienen, y eso merece un aviso.
 *
 * Las cuentas archivadas quedan afuera, igual que en el patrimonio: si no
 * cuentan como plata disponible, tampoco pueden respaldar una jarra.
 */
/**
 * Cuanto se lleva gastado contra un presupuesto de evento.
 *
 * Suma los gastos que APUNTAN a el, no los que caen en sus fechas ni los de
 * ciertas categorias: en un viaje se sigue pagando el alquiler de casa, y ese
 * no es del viaje. Que un gasto sea del evento lo dicen ustedes al cargarlo.
 *
 * Las transferencias y los ajustes no cuentan: no son gasto.
 */
export function gastadoEnEvento(budgetId: string, transactions: Transaction[]): number {
  let total = 0;
  for (const t of transactions) {
    if (t.budgetId !== budgetId || t.type !== TxType.GASTO) continue;
    total += t.amountMinor;
  }
  return total;
}

export function sinAsignar(accounts: Account[], saldosJarras: Map<string, number>): number {
  const enCuentas = accounts.reduce((t, a) => (a.archived ? t : t + a.balanceMinor), 0);
  let enJarras = 0;
  for (const saldo of saldosJarras.values()) enJarras += saldo;
  return enCuentas - enJarras;
}

/**
 * Que el reparto de una entidad sea valido.
 *
 * Sin jarra de resto, los porcentajes tienen que dar 100% exacto: si no,
 * parte del ingreso no llegaria a ninguna jarra.
 *
 * Con jarra de resto la regla se afloja a "no pasarse de 100%", porque el
 * resto absorbe lo que quede. Es lo que hace usable el modo de negocio: "20%
 * impuestos, $100 publicidad, el resto a operacion" no se puede expresar con
 * la regla dura.
 */
export function validarJarras(jars: Jar[]): {
  ok: boolean; sumaBp: number; motivo?: string;
} {
  const sumaBp = jars
    .filter((j) => j.fillKind === 'porcentaje')
    .reduce((a, j) => a + j.percentageBp, 0);

  const restos = jars.filter((j) => j.fillKind === 'resto');

  if (restos.length > 1) {
    return { ok: false, sumaBp, motivo: 'Solo puede haber una jarra que se lleve el resto' };
  }

  if (restos.length === 0) {
    const hayFijas = jars.some((j) => j.fillKind === 'fijo');
    if (hayFijas) {
      return {
        ok: false, sumaBp,
        motivo: 'Con jarras de monto fijo hace falta una que se lleve el resto',
      };
    }
    return {
      ok: sumaBp === 10_000,
      sumaBp,
      motivo: sumaBp === 10_000 ? undefined : 'Los porcentajes tienen que sumar 100%',
    };
  }

  return {
    ok: sumaBp <= 10_000,
    sumaBp,
    motivo: sumaBp <= 10_000 ? undefined : 'Los porcentajes no pueden pasar de 100%',
  };
}

// ---------------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------------

/**
 * De quien es un movimiento.
 *
 * La entidad vive en la CATEGORIA y el movimiento la hereda. Escribirla en
 * cada movimiento habria significado una pregunta mas en cada carga y 44
 * decisiones en vez de 13; y sobre todo, corregirse despues seria reescribir
 * movimientos uno por uno. Asi, cambiar la entidad de una categoria
 * reclasifica toda su historia sin tocar un solo registro.
 *
 * El campo del movimiento solo se usa cuando se corrige uno suelto a mano, o
 * cuando no hay categoria (una transferencia).
 */
export function entidadDe(
  tx: Pick<Transaction, 'entityId' | 'categoryId'>,
  categorias: Map<string, Category>,
): string | null {
  if (tx.entityId) return tx.entityId;
  if (!tx.categoryId) return null;
  return categorias.get(tx.categoryId)?.entityId ?? null;
}

/**
 * La entidad que se usa cuando el movimiento no dice ninguna: la primera de
 * la lista, que es la casa.
 *
 * Un ingreso sin categoria tiene que seguir cayendo en los frascos del hogar,
 * que es donde caia antes de que existieran los negocios. Sin este piso, el
 * interruptor de repartir seria un boton que no hace nada.
 */
export const entidadPorDefecto = (entities: Entity[]): string | null =>
  [...entities]
    .filter((e) => !e.archived)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.createdAt - b.createdAt)[0]?.id
  ?? null;

/**
 * Las jarras que reparten un movimiento de esta entidad.
 *
 * Un cobro de PanaClaw se reparte entre las jarras de PanaClaw —impuestos,
 * insumos, publicidad—, no entre los frascos de la casa. A la casa la plata
 * llega despues, cuando el negocio le paga a alguien: ese es otro movimiento
 * y ese si cae en los seis frascos.
 *
 * Por eso los porcentajes suman 100% DENTRO de cada entidad y no entre todas:
 * son repartos de ingresos distintos.
 */
export function jarrasDe(
  jars: Jar[],
  entityId: string | null,
  porDefecto: string | null = null,
): Jar[] {
  const objetivo = entityId ?? porDefecto;
  return jars.filter((j) => j.entityId === objetivo);
}

/** Indice por id, para no recorrer la lista en cada movimiento. */
export const indexarCategorias = (categorias: Category[]): Map<string, Category> =>
  new Map(categorias.map((c) => [c.id, c]));

export interface ResultadoEntidad {
  entityId: string | null;
  ingresoMinor: number;
  gastoMinor: number;
  resultadoMinor: number;
  cantidad: number;
}

/**
 * Ingresos menos gastos, por entidad.
 *
 * Es la pregunta que la app no podia responder: no "cuanto capital tengo",
 * sino si el negocio da. Reusa `resumir`, asi que hereda sus reglas: las
 * transferencias entre cuentas propias y los ajustes de saldo no son ni
 * ingreso ni gasto.
 *
 * La clave null junta lo que todavia no tiene entidad, para que nada
 * desaparezca del total por estar sin clasificar.
 */
export function resultadoPorEntidad(
  transactions: Transaction[],
  categorias: Category[],
): ResultadoEntidad[] {
  const indice = indexarCategorias(categorias);
  const grupos = new Map<string | null, Transaction[]>();

  for (const tx of transactions) {
    const e = entidadDe(tx, indice);
    grupos.set(e, [...(grupos.get(e) ?? []), tx]);
  }

  return [...grupos].map(([entityId, movs]) => {
    const r = resumir(movs);
    return {
      entityId,
      ingresoMinor: r.ingresoMinor,
      gastoMinor: r.gastoMinor,
      resultadoMinor: r.flujoMinor,
      cantidad: r.cantidad,
    };
  }).sort((a, b) => Math.abs(b.resultadoMinor) - Math.abs(a.resultadoMinor));
}

/** Los movimientos de una entidad. `null` devuelve todos. */
export function filtrarPorEntidad(
  transactions: Transaction[],
  categorias: Category[],
  entityId: string | null,
): Transaction[] {
  if (entityId === null) return transactions;
  const indice = indexarCategorias(categorias);
  return transactions.filter((tx) => entidadDe(tx, indice) === entityId);
}

// ---------------------------------------------------------------------------
// Periodos y resumenes
// ---------------------------------------------------------------------------

/** Clave de mes YYYY-MM a partir de un epoch, en la zona horaria local. */
export function claveMes(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Limites [inicio, fin] de un mes YYYY-MM, en epoch local. */
export function rangoMes(period: string): [number, number] {
  const [y, m] = period.split('-').map(Number);
  return [
    new Date(y, m - 1, 1, 0, 0, 0, 0).getTime(),
    new Date(y, m, 0, 23, 59, 59, 999).getTime(),
  ];
}

export function transaccionesDelMes(transactions: Transaction[], period: string): Transaction[] {
  const [ini, fin] = rangoMes(period);
  return transactions.filter((t) => t.date >= ini && t.date <= fin);
}

export interface Resumen {
  ingresoMinor: number;
  gastoMinor: number;
  flujoMinor: number;
  cantidad: number;
}

/**
 * Resumen de un conjunto de movimientos.
 * Las transferencias se excluyen a proposito: mover plata de una cuenta propia
 * a otra cuenta propia no es ni ingreso ni gasto, y contarlo infla los dos
 * lados del resumen. Los ajustes tampoco cuentan como gasto real.
 */
export function resumir(transactions: Transaction[]): Resumen {
  let ingresoMinor = 0;
  let gastoMinor = 0;

  for (const t of transactions) {
    if (t.type === TxType.INGRESO) ingresoMinor += t.amountMinor;
    else if (t.type === TxType.GASTO) gastoMinor += t.amountMinor;
  }

  return {
    ingresoMinor,
    gastoMinor,
    flujoMinor: ingresoMinor - gastoMinor,
    cantidad: transactions.length,
  };
}

/** Totales por categoria, de mayor a menor. */
export function porCategoria(
  transactions: Transaction[],
  categories: Category[],
  tipo: 'ingreso' | 'gasto',
): { category: Category | null; totalMinor: number; cantidad: number }[] {
  const buscada = tipo === 'gasto' ? TxType.GASTO : TxType.INGRESO;
  const mapa = new Map<string, { totalMinor: number; cantidad: number }>();

  for (const t of transactions) {
    if (t.type !== buscada) continue;
    const key = t.categoryId ?? '__sin__';
    const actual = mapa.get(key) ?? { totalMinor: 0, cantidad: 0 };
    actual.totalMinor += t.amountMinor;
    actual.cantidad += 1;
    mapa.set(key, actual);
  }

  const porId = new Map(categories.map((c) => [c.id, c]));
  return [...mapa.entries()]
    .map(([id, v]) => ({ category: porId.get(id) ?? null, ...v }))
    .sort((a, b) => b.totalMinor - a.totalMinor);
}

/**
 * A quien se le atribuye un movimiento.
 *
 * Vale quien lo hizo; si no se dijo, quien lo cargo. La distincion importa
 * porque uno puede anotar la compra que hizo el otro, y para las estadisticas
 * lo que cuenta es quien gasto, no quien tuvo el telefono en la mano.
 */
export const autorDe = (tx: Transaction): string => tx.paidBy ?? tx.createdBy;

/**
 * Quien gasto cuanto. Esta es la vista individual que pedia el planteo:
 * el libro es compartido, pero cada movimiento sabe de quien fue.
 */
export function porPersona(
  transactions: Transaction[],
  members: Member[],
): { member: Member; resumen: Resumen }[] {
  return members
    .map((member) => ({
      member,
      resumen: resumir(transactions.filter((t) => autorDe(t) === member.id)),
    }))
    .sort((a, b) => b.resumen.gastoMinor - a.resumen.gastoMinor);
}

/** Balance de cada mes de un rango, para el grafico de evolucion. */
export function balancePorMes(
  transactions: Transaction[],
  periodos: string[],
): { periodo: string; resumen: Resumen; acumuladoMinor: number }[] {
  let acumuladoMinor = 0;
  return periodos.map((periodo) => {
    const resumen = resumir(transaccionesDelMes(transactions, periodo));
    acumuladoMinor += resumen.flujoMinor;
    return { periodo, resumen, acumuladoMinor };
  });
}

/**
 * Estado de cada presupuesto del mes.
 *
 * Un tope de categoria cuenta solo esa categoria, y con eso ya queda acotado a
 * su economia: la categoria sabe de quien es. El tope global cuenta todo el
 * mes, salvo que lleve entidad, y entonces cuenta solo esa economia — que es
 * la unica forma de decir "PanaClaw no gasta mas de X este mes".
 *
 * `categorias` hace falta para eso ultimo: la economia de un movimiento sale
 * de su categoria. Sin ella, un tope con entidad no puede filtrar nada.
 */
export function estadoPresupuestos(
  budgets: Budget[],
  transactions: Transaction[],
  period: string,
  categorias: Category[] = [],
): { budget: Budget; gastadoMinor: number; ratio: number }[] {
  const delMes = transaccionesDelMes(transactions, period);
  const indice = indexarCategorias(categorias);

  return budgets
    // Los de evento («Viaje a Cancún») no son del mes aunque nacieran en el:
    // no tienen categoria, asi que aca contarian TODO el gasto del mes como
    // suyo. Se miden aparte, con gastadoEnEvento.
    .filter((b) => b.period === period && !esEvento(b))
    .map((budget) => {
      const gastadoMinor = sumarMinor(
        ...delMes
          .filter((t) => {
            if (t.type !== TxType.GASTO) return false;
            if (budget.categoryId !== null) return t.categoryId === budget.categoryId;
            if (budget.entityId !== null) return entidadDe(t, indice) === budget.entityId;
            return true;
          })
          .map((t) => t.amountMinor),
      );
      return {
        budget,
        gastadoMinor,
        ratio: budget.amountMinor > 0 ? gastadoMinor / budget.amountMinor : 0,
      };
    });
}
