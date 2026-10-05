/**
 * Fuente unica de verdad del dominio, compartida por el cliente y el Worker.
 *
 * El repo anterior tenia dos definiciones en conflicto (src/types.ts y
 * src/types/index.ts) donde, por ejemplo, Transaction.date era string en una y
 * number en la otra. Eso ya no puede pasar: este archivo es el unico.
 *
 * REGLA DE ORO: todo monto es un entero en unidades minimas (centavos).
 * Nunca un float. 0.1 + 0.2 !== 0.3 en JavaScript, y con plata eso es un bug
 * que se acumula en silencio hasta que los saldos dejan de cuadrar.
 */

import type { Frecuencia } from './recurrencia.ts';

// ---------------------------------------------------------------------------
// Transacciones
// ---------------------------------------------------------------------------

/**
 * Tipos de movimiento. La numeracion viene del modelo de ezBookkeeping, que
 * acierta en algo que la version anterior no tenia: AJUSTE es un tipo propio.
 * Cuando el saldo real no coincide con el de la app (te descontaron una
 * comision, redondeaste mal), registras un ajuste en vez de "arreglar" el saldo
 * a mano. Asi el historial siempre explica cada peso.
 */
export const TxType = {
  AJUSTE: 1,
  INGRESO: 2,
  GASTO: 3,
  TRANSFERENCIA: 4,
} as const;
export type TxType = (typeof TxType)[keyof typeof TxType];

export const TX_TYPE_LABEL: Record<TxType, string> = {
  [TxType.AJUSTE]: 'Ajuste de saldo',
  [TxType.INGRESO]: 'Ingreso',
  [TxType.GASTO]: 'Gasto',
  [TxType.TRANSFERENCIA]: 'Transferencia',
};

export interface Transaction {
  id: string;
  householdId: string;
  type: TxType;
  /** Entero en centavos, siempre positivo. El tipo define el signo. */
  amountMinor: number;
  /** Cuenta de origen. En un ingreso, la cuenta que recibe. */
  accountId: string;
  /** Solo en transferencias: cuenta de destino. */
  destAccountId: string | null;
  /**
   * Solo en transferencias entre monedas distintas. Si es null, se asume
   * igual a amountMinor.
   */
  destAmountMinor: number | null;
  categoryId: string | null;
  /** Jarra a la que se imputa un gasto, si aplica. */
  jarId: string | null;
  /** Si es un ingreso, repartirlo entre las jarras segun sus porcentajes. */
  distributeToJars: boolean;
  description: string;
  notes: string | null;
  /** Epoch en milisegundos, UTC. */
  date: number;
  /**
   * Quien lo cargo en la app. Se asigna solo y no se edita nunca: es el
   * rastro de quien estuvo usando la aplicacion.
   */
  createdBy: string;
  /**
   * Quien hizo el gasto de verdad, que no siempre es quien lo cargo: uno
   * puede anotar la compra que hizo el otro. null significa "el mismo que lo
   * cargo". Es este el que cuenta para las estadisticas por persona.
   */
  paidBy: string | null;
  /** Si nacio de un pago habitual, cual. */
  recurringId: string | null;
  /**
   * Presupuesto de evento al que cuenta este gasto: «esto fue del viaje».
   * NULL es lo normal: la enorme mayoria de los gastos no son de un evento.
   * Se elige al cargar y no se deduce de fechas ni categorias, porque en un
   * viaje se sigue pagando el alquiler de casa y ese no es del viaje.
   */
  budgetId: string | null;
  /**
   * De quien es este movimiento. NULL = la de su categoria, que es el caso
   * normal. Solo se escribe cuando se corrige a mano uno suelto, o cuando no
   * hay categoria (una transferencia).
   */
  entityId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Lo que el cliente manda para crear o editar. El servidor pone el resto. */
export type TransactionInput = Omit<
  Transaction,
  'id' | 'householdId' | 'createdBy' | 'createdAt' | 'updatedAt'
> & { id?: string };

// ---------------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------------

/**
 * De quien es la plata: la casa o uno de los negocios.
 *
 * Un solo libro con tres dueños, no tres apps: lo valioso es justamente poder
 * cruzarlos. `kind` no cambia ninguna logica, solo el vocabulario de la
 * pantalla y las jarras que se proponen al crearla.
 */
/**
 * Lo que se puede sacar de circulacion sin perder su historia.
 *
 * `archived` y la papelera son dos cosas distintas a proposito:
 *
 *   archivado -> se jubila pero su historia importa. Sigue contando en los
 *                totales del pasado y no se puede borrar mientras algo lo use.
 *   papelera  -> se tiro. Se restaura de un toque, y vaciarla lo borra.
 *
 * Se guarda quien lo tiro porque son dos personas y «¿esto lo tiraste tú?»
 * tiene que tener respuesta.
 */
export interface Descartable {
  archived: boolean;
  /** Epoch en que se mando a la papelera. null = no esta en la papelera. */
  trashedAt: number | null;
  /** Quien la mando. */
  trashedBy: string | null;
}

export interface Entity extends Descartable {
  id: string;
  householdId: string;
  name: string;
  kind: 'personal' | 'negocio';
  color: string;
  icon: string;
  displayOrder: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------------

/**
 * Categorias de cuenta con semantica de activo/pasivo, tomada de ezBookkeeping.
 * Importa de verdad: una tarjeta de credito con "saldo" 50.000 no es plata que
 * tenes, es plata que debes. Sumarla al patrimonio como hacia la version
 * anterior te miente en la cara.
 */
export const AccountCategory = {
  EFECTIVO: 1,
  CUENTA_CORRIENTE: 2,
  TARJETA_CREDITO: 3,
  AHORRO: 4,
  INVERSION: 5,
  DEUDA: 6,
  POR_COBRAR: 7,
} as const;
export type AccountCategory = (typeof AccountCategory)[keyof typeof AccountCategory];

/** true = suma al patrimonio; false = resta (es un pasivo). */
const ES_ACTIVO: Record<AccountCategory, boolean> = {
  [AccountCategory.EFECTIVO]: true,
  [AccountCategory.CUENTA_CORRIENTE]: true,
  [AccountCategory.TARJETA_CREDITO]: false,
  [AccountCategory.AHORRO]: true,
  [AccountCategory.INVERSION]: true,
  [AccountCategory.DEUDA]: false,
  [AccountCategory.POR_COBRAR]: true,
};

export const esActivo = (c: AccountCategory): boolean => ES_ACTIVO[c] ?? true;
export const esPasivo = (c: AccountCategory): boolean => !esActivo(c);

export const ACCOUNT_CATEGORY_LABEL: Record<AccountCategory, string> = {
  [AccountCategory.EFECTIVO]: 'Efectivo',
  [AccountCategory.CUENTA_CORRIENTE]: 'Cuenta corriente',
  [AccountCategory.TARJETA_CREDITO]: 'Tarjeta de crédito',
  [AccountCategory.AHORRO]: 'Ahorro',
  [AccountCategory.INVERSION]: 'Inversión',
  [AccountCategory.DEUDA]: 'Deuda',
  [AccountCategory.POR_COBRAR]: 'Por cobrar',
};

export interface Account extends Descartable {
  id: string;
  householdId: string;
  name: string;
  category: AccountCategory;
  currency: string;
  /** Saldo con el que arranca la cuenta. Los movimientos se suman encima. */
  initialBalanceMinor: number;
  /**
   * Saldo actual, derivado: initialBalanceMinor + suma de movimientos.
   * El servidor lo calcula con SQL en cada lectura, no lo guarda incrementando.
   * Por eso no puede desincronizarse nunca.
   */
  balanceMinor: number;
  color: string;
  icon: string;
  /**
   * De quien es la cuenta. 'compartida' la ven y usan los dos;
   * si es de una persona, sigue siendo visible para ambos (son pareja) pero
   * se separa en los totales individuales.
   */
  owner: 'compartida' | string;
  displayOrder: number;
  createdAt: number;
  updatedAt: number;
  /**
   * De que negocio es esta cuenta. NULL = mezclada, que hoy son todas.
   * Solo sirve como valor por defecto al cargar y para saber de quien era el
   * efectivo cuando una entidad le paga algo a otra.
   */
  entityId: string | null;
}

// ---------------------------------------------------------------------------
// Categorias (dos niveles, como ezBookkeeping)
// ---------------------------------------------------------------------------

export interface Category extends Descartable {
  id: string;
  householdId: string;
  name: string;
  type: 'ingreso' | 'gasto';
  /** null = categoria de primer nivel. Si no, es subcategoria. */
  parentId: string | null;
  icon: string;
  color: string;
  displayOrder: number;
  createdAt: number;
  /**
   * De quien es lo que se gasta o se cobra con esta categoria.
   *
   * Aca es donde vive la entidad, y no en el movimiento. Ellos ya venian
   * clasificando asi con el unico campo que tenian: crearon categorias
   * llamadas "PanaClaw" y "BukoFlow". Poner la entidad aca convierte 44
   * decisiones en 13 y no agrega ninguna pregunta al cargar un gasto.
   *
   * Ademas la hace reversible: si se equivocan, cambian la categoria y toda su
   * historia se reclasifica sola, sin reescribir un solo movimiento.
   */
  entityId: string | null;
}

// ---------------------------------------------------------------------------
// Jarras (metodo de los 6 frascos) - feature propia del repo, conservada
// ---------------------------------------------------------------------------

export interface Jar {
  id: string;
  householdId: string;
  name: string;
  /**
   * Si acumula, el numero grande es el de toda la vida (Ahorro largo plazo).
   * Si no, el del periodo elegido (Necesidades, Diversion).
   *
   * Es solo como se lee: lo que sobra de un mes NO se tira, se queda adentro.
   */
  acumula: boolean;
  /**
   * Porcentaje en puntos base: 2,5% se guarda como 250, no como 0.025.
   * Entero otra vez, por el mismo motivo que los montos.
   */
  percentageBp: number;
  color: string;
  icon: string;
  displayOrder: number;
  createdAt: number;
  /** Derivado de las imputaciones, igual que el saldo de cuenta. */
  balanceMinor: number;
  /** De que economia es esta jarra. Los porcentajes suman 100% por entidad. */
  entityId: string | null;
  /**
   * Como se llena. Los frascos de una casa van por porcentaje porque el
   * ingreso es parejo; un cobro de agencia que va de $50 a $5.000 se
   * presupuesta mejor con montos fijos y una jarra que absorba el resto.
   */
  fillKind: 'porcentaje' | 'fijo' | 'resto';
  /** Centavos, solo cuando fillKind es 'fijo'. */
  fillMinor: number | null;
}

/**
 * Lo que un movimiento le hizo a una jarra, escrito en el momento.
 *
 * Antes el saldo se recalculaba en cada lectura con los porcentajes vigentes,
 * asi que cambiar un porcentaje reescribia el pasado. Congelar la imputacion
 * es lo que hace que el historial se quede quieto.
 */
export interface JarImputacion {
  id: string;
  householdId: string;
  txId: string;
  jarId: string;
  /** Positivo entra, negativo sale. */
  amountMinor: number;
  createdAt: number;
}

/**
 * Mover plata de una jarra a otra. No toca ninguna cuenta: no es un
 * movimiento de dinero, es un cambio de plan.
 */
export interface JarTransfer {
  id: string;
  householdId: string;
  fromJarId: string;
  toJarId: string;
  amountMinor: number;
  note: string | null;
  date: number;
  createdBy: string;
  createdAt: number;
}

/**
 * Plata que entra a una jarra sin venir de un movimiento: sale de lo que esta
 * sin asignar.
 *
 * Es lo que permite repartir el capital con el que se arranco —los saldos
 * iniciales de las cuentas—, que las jarras nunca vieron porque solo ven
 * movimientos. Negativo devuelve la plata a sin asignar.
 */
export interface JarAporte {
  id: string;
  householdId: string;
  jarId: string;
  amountMinor: number;
  note: string | null;
  date: number;
  createdBy: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Presupuestos
// ---------------------------------------------------------------------------

/**
 * Un presupuesto es un evento con nombre y tope: «Viaje a Cancún, $2.000».
 *
 * NO es un tope mensual por categoria: eso es una jarra, que acumula mes a mes
 * y vive sola. Un presupuesto nace, se gasta y se cierra.
 *
 * Solo mide: no aparta plata ni toca ninguna cuenta. La plata sale de las
 * jarras como cualquier gasto; el presupuesto lleva la cuenta.
 *
 * Un gasto entra al evento porque ustedes lo dicen al cargarlo (`tx.budgetId`),
 * no por fechas ni por categorias: en un viaje se sigue pagando el alquiler de
 * casa, y ese no es del viaje.
 */
export interface Budget {
  id: string;
  householdId: string;
  /** Nombre del evento. Los viejos, por mes y categoria, no lo tienen. */
  name: string | null;
  /** El presupuesto de publicidad de un negocio no come el de comida. */
  entityId: string | null;
  /** null = presupuesto global del mes. Solo lo usan los viejos. */
  categoryId: string | null;
  amountMinor: number;
  /** Mes en formato YYYY-MM. En un evento es solo el mes en que nacio. */
  period: string;
  /** Epoch del cierre. null = abierto. */
  closedAt: number | null;
  /** Icono, como el de una jarra o una categoria. null = uno generico. */
  icon: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Un presupuesto de evento es el que tiene nombre. */
export const esEvento = (b: Budget): boolean => b.name !== null && b.name !== '';

// ---------------------------------------------------------------------------
// Ajustes manuales de saldo
// ---------------------------------------------------------------------------

/**
 * Una correccion a mano del saldo de una cuenta.
 *
 * No es un movimiento: no aparece en la lista, no entra en las estadisticas y
 * no tiene categoria. Es la constancia de que alguien dijo "esta cuenta tiene
 * tanto" y de cuanto se movio el numero al decirlo. Por dentro lo que cambia
 * es el saldo inicial de la cuenta, nunca los movimientos.
 */
export interface Adjustment {
  id: string;
  householdId: string;
  accountId: string;
  /** Quien lo hizo. null si esa persona ya no esta en el hogar. */
  memberId: string | null;
  fromMinor: number;
  toMinor: number;
  /** toMinor - fromMinor. Guardado aparte para no recalcularlo al leer. */
  deltaMinor: number;
  note: string | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Pagos habituales
// ---------------------------------------------------------------------------

export interface Recurring {
  id: string;
  householdId: string;
  name: string;
  /** Solo INGRESO o GASTO: no tiene sentido una transferencia automatica. */
  type: TxType;
  amountMinor: number;
  accountId: string;
  categoryId: string | null;
  jarId: string | null;
  /**
   * Repartir el ingreso entre las jarras al crearlo. Sin esto, un sueldo que
   * entra por un pago habitual no puede llegar a ninguna jarra: el disparador
   * lo insertaba con el reparto apagado a mano.
   */
  distributeToJars: boolean;
  paidBy: string | null;
  /** La lista vive en shared/recurrencia.ts, que es quien calcula con ella. */
  frequency: Frecuencia;
  dayOfMonth: number | null;
  /** Segundo cobro del mes. Solo quincenal; 31 significa el ultimo dia. */
  dayOfMonth2: number | null;
  dayOfWeek: number | null;
  /** Mes del ciclo: literal en la anual, ancla en trimestral y semestral. */
  monthOfYear: number | null;
  active: boolean;
  entityId: string | null;
  /** Cuando toca el proximo. Avanzar esto es lo que evita duplicados. */
  nextRun: number;
  lastRun: number | null;
  /**
   * La fecha del ciclo que se dio por cobrado y despues se deshizo, o null.
   *
   * Con valor, la pantalla lo muestra como pendiente y confirmarlo NO adelanta
   * `nextRun`: ese ciclo ya estaba consumido. Ver migracion 0006.
   */
  esperandoDesde: number | null;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Personas y hogar
// ---------------------------------------------------------------------------

export const TEMAS = ['auto', 'claro', 'oscuro'] as const;
export type Tema = (typeof TEMAS)[number];

export const TEMA_LABEL: Record<Tema, string> = {
  auto: 'Automático',
  claro: 'Claro',
  oscuro: 'Oscuro',
};

export interface Member {
  id: string;
  householdId: string;
  email: string;
  displayName: string;
  /** Color con el que se lo identifica en la app. */
  color: string;
  /** Emoji del avatar. Vacio = se muestran las iniciales. */
  emoji: string;
  /**
   * Orden de las secciones del Inicio. Vacio = el orden por defecto.
   * Es por persona: cada uno acomoda su pantalla como quiere.
   */
  homeLayout: SeccionInicio[];
  /** Lo mismo, para la pantalla de movimientos. Vacio = el de fabrica. */
  movesLayout: SeccionMovimientos[];
  /**
   * Tema de esta persona. 'auto' sigue al telefono, que es lo de siempre.
   * Es por persona y no por hogar: son dos telefonos y dos gustos.
   */
  theme: Tema;
  /**
   * Foto del avatar como data URI, ya recortada y achicada en el navegador.
   * Vacia = se usa el emoji, y sin emoji las iniciales.
   */
  photo: string;
  createdAt: number;
}

/** Secciones que se pueden ordenar y ocultar en el Inicio. */
/**
 * El orden de fabrica del Inicio. Cada persona puede cambiarlo en Ajustes.
 *
 * El patrimonio va primero porque es lo que se quiere ver al abrir la app:
 * cuanto hay. El balance del mes es importante pero es una foto del pasado
 * reciente; el patrimonio es el estado de hoy.
 */
export const SECCIONES_INICIO = [
  'patrimonio', 'resumen', 'quien-gasto', 'presupuestos',
  'por-categoria', 'pagos-habituales', 'ultimos',
] as const;
export type SeccionInicio = (typeof SECCIONES_INICIO)[number];

/**
 * Las piezas de la pantalla de movimientos que se pueden ordenar u ocultar.
 *
 * La lista en si no esta: es la pantalla, no una seccion. Lo que se acomoda es
 * lo que va ARRIBA de ella, que es justo lo que empuja los movimientos fuera de
 * la vista al abrir.
 */
export const SECCIONES_MOVIMIENTOS = ['periodo', 'buscador', 'resumen'] as const;
export type SeccionMovimientos = (typeof SECCIONES_MOVIMIENTOS)[number];

export const SECCION_MOVIMIENTOS_LABEL: Record<SeccionMovimientos, string> = {
  'periodo': 'Selector de período',
  'buscador': 'Buscador y filtros',
  'resumen': 'Totales del período',
};

export const SECCION_LABEL: Record<SeccionInicio, string> = {
  'resumen': 'Balance del mes',
  'patrimonio': 'Patrimonio',
  'quien-gasto': 'Quién gastó',
  'presupuestos': 'Presupuestos',
  'por-categoria': 'En qué se fue',
  'pagos-habituales': 'Pagos habituales',
  'ultimos': 'Últimos movimientos',
};

export interface Household {
  id: string;
  name: string;
  currency: string;
  createdAt: number;
}

/** Todo lo que el cliente necesita en un solo viaje al arrancar. */
export interface Snapshot {
  household: Household;
  members: Member[];
  me: Member;
  accounts: Account[];
  categories: Category[];
  jars: Jar[];
  budgets: Budget[];
  entities: Entity[];
  transactions: Transaction[];
  recurring: Recurring[];
  /** Lo que cada movimiento le hizo a cada jarra, congelado. */
  imputaciones: JarImputacion[];
  jarTransfers: JarTransfer[];
  /** Lo asignado a mano desde el sin asignar. Ver JarAporte. */
  jarAportes: JarAporte[];
}

// ---------------------------------------------------------------------------
// Mensajes de tiempo real
// ---------------------------------------------------------------------------

export type LiveEvent =
  | { kind: 'tx:upsert'; tx: Transaction; by: string }
  | { kind: 'tx:delete'; id: string; by: string }
  | { kind: 'account:upsert'; account: Account; by: string }
  | { kind: 'account:delete'; id: string; by: string }
  | { kind: 'category:upsert'; category: Category; by: string }
  | { kind: 'entity:upsert'; entity: Entity; by: string }
  | { kind: 'entity:delete'; id: string; by: string }
  | { kind: 'jar:upsert'; jar: Jar; by: string }
  /**
   * Las jarras cambiaron enteras (porcentajes, nombres, altas y bajas). Se
   * mandan todas juntas porque se guardan juntas: un reparto a medio aplicar
   * no seria valido.
   */
  | { kind: 'jars'; jars: Jar[]; by: string }
  | { kind: 'jarTransfer:upsert'; transfer: JarTransfer; by: string }
  | { kind: 'jarTransfer:delete'; id: string; by: string }
  | { kind: 'jarAporte:upsert'; aporte: JarAporte; by: string }
  | { kind: 'jarAporte:delete'; id: string; by: string }
  /**
   * Las imputaciones de un movimiento. Van con el evento del movimiento y no
   * dentro de el porque tambien cambian solas cuando se reparte un ingreso
   * viejo desde la puesta al dia.
   */
  | { kind: 'imputaciones'; txId: string; imputaciones: JarImputacion[]; by: string }
  | { kind: 'budget:upsert'; budget: Budget; by: string }
  | { kind: 'budget:delete'; id: string; by: string }
  | { kind: 'member:upsert'; member: Member; by: string }
  | { kind: 'recurring:upsert'; recurring: Recurring; by: string }
  | { kind: 'recurring:delete'; id: string; by: string }
  /**
   * Algo cambio por fuera de la app (el disparador de pagos habituales) y
   * conviene recargar. Trae los saldos ya recalculados.
   */
  | {
      kind: 'recargar';
      accounts: Account[];
      jars: Jar[];
      imputaciones?: JarImputacion[];
    }
  | { kind: 'presence'; online: string[] }
  | { kind: 'hello'; online: string[] };
