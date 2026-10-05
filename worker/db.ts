/**
 * Acceso a D1: mapeo de filas a tipos del dominio y consultas.
 *
 * Decision importante: los saldos NO se guardan. Se derivan.
 *
 * La version anterior guardaba `balance` en cada cuenta y lo iba moviendo con
 * `increment()` en cada alta, baja y edicion. Ese patron se desincroniza sin
 * remedio: basta un fallo a mitad de camino, una edicion que revierte mal o
 * dos escrituras cruzadas para que el saldo deje de corresponder a los
 * movimientos, y despues no hay forma de saber cual de los dos numeros es el
 * correcto.
 *
 * Aca el saldo es siempre `saldo inicial + suma de los movimientos`, calculado
 * por SQL en cada lectura. Es imposible que discrepe, y con el indice sobre
 * account_id el costo es despreciable para el volumen de una pareja.
 */

import type {
  Account, Adjustment, Budget, Category, Entity, Household, Jar, JarImputacion,
  JarAporte, JarTransfer, Member, Recurring,
  Snapshot, Transaction,
} from '../shared/types.ts';
import { SECCIONES_INICIO, SECCIONES_MOVIMIENTOS, TEMAS } from '../shared/types.ts';
import type { AccountCategory, Tema, TxType } from '../shared/types.ts';
import { calcularJarras } from '../shared/domain.ts';
import type { Env } from './env.ts';

// --- mapeo de filas ------------------------------------------------------

type Fila = Record<string, unknown>;

const int = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string => String(v ?? '');
const strOpt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const intOpt = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => Number(v ?? 0) === 1;

export const aAccount = (f: Fila): Account => ({
  id: str(f.id),
  householdId: str(f.household_id),
  name: str(f.name),
  category: int(f.category) as AccountCategory,
  currency: str(f.currency),
  initialBalanceMinor: int(f.initial_balance_minor),
  balanceMinor: int(f.balance_minor),
  color: str(f.color),
  icon: str(f.icon),
  owner: str(f.owner),
  archived: bool(f.archived),
  trashedAt: intOpt(f.trashed_at),
  trashedBy: strOpt(f.trashed_by),
  displayOrder: int(f.display_order),
  createdAt: int(f.created_at),
  updatedAt: int(f.updated_at),
  entityId: strOpt(f.entity_id),
});

export const aCategory = (f: Fila): Category => ({
  id: str(f.id),
  householdId: str(f.household_id),
  name: str(f.name),
  type: str(f.type) === 'ingreso' ? 'ingreso' : 'gasto',
  parentId: strOpt(f.parent_id),
  icon: str(f.icon),
  color: str(f.color),
  archived: bool(f.archived),
  trashedAt: intOpt(f.trashed_at),
  trashedBy: strOpt(f.trashed_by),
  displayOrder: int(f.display_order),
  createdAt: int(f.created_at),
  entityId: strOpt(f.entity_id),
});

export const aJar = (f: Fila): Jar => ({
  id: str(f.id),
  householdId: str(f.household_id),
  name: str(f.name),
  percentageBp: int(f.percentage_bp),
  color: str(f.color),
  icon: str(f.icon),
  displayOrder: int(f.display_order),
  createdAt: int(f.created_at),
  acumula: bool(f.acumula),
  entityId: strOpt(f.entity_id),
  fillKind: (['porcentaje', 'fijo', 'resto'] as const).includes(f.fill_kind as 'fijo')
    ? (f.fill_kind as 'porcentaje' | 'fijo' | 'resto')
    : 'porcentaje',
  fillMinor: intOpt(f.fill_minor),
  balanceMinor: 0, // se completa despues con calcularJarras
});

export const aEntity = (f: Fila): Entity => ({
  id: str(f.id),
  householdId: str(f.household_id),
  name: str(f.name),
  kind: f.kind === 'negocio' ? 'negocio' : 'personal',
  color: str(f.color),
  icon: str(f.icon),
  displayOrder: int(f.display_order),
  archived: bool(f.archived),
  trashedAt: intOpt(f.trashed_at),
  trashedBy: strOpt(f.trashed_by),
  createdAt: int(f.created_at),
});

export const aJarImputacion = (f: Fila): JarImputacion => ({
  id: str(f.id),
  householdId: str(f.household_id),
  txId: str(f.tx_id),
  jarId: str(f.jar_id),
  amountMinor: int(f.amount_minor),
  createdAt: int(f.created_at),
});

export const aJarTransfer = (f: Fila): JarTransfer => ({
  id: str(f.id),
  householdId: str(f.household_id),
  fromJarId: str(f.from_jar_id),
  toJarId: str(f.to_jar_id),
  amountMinor: int(f.amount_minor),
  note: strOpt(f.note),
  date: int(f.date),
  createdBy: str(f.created_by),
  createdAt: int(f.created_at),
});

export const aJarAporte = (f: Fila): JarAporte => ({
  id: str(f.id),
  householdId: str(f.household_id),
  jarId: str(f.jar_id),
  amountMinor: int(f.amount_minor),
  note: strOpt(f.note),
  date: int(f.date),
  createdBy: str(f.created_by),
  createdAt: int(f.created_at),
});

export const aTransaction = (f: Fila): Transaction => ({
  id: str(f.id),
  householdId: str(f.household_id),
  type: int(f.type) as TxType,
  amountMinor: int(f.amount_minor),
  accountId: str(f.account_id),
  destAccountId: strOpt(f.dest_account_id),
  destAmountMinor: f.dest_amount_minor === null || f.dest_amount_minor === undefined
    ? null
    : int(f.dest_amount_minor),
  categoryId: strOpt(f.category_id),
  jarId: strOpt(f.jar_id),
  distributeToJars: bool(f.distribute_to_jars),
  description: str(f.description),
  notes: strOpt(f.notes),
  date: int(f.date),
  createdBy: str(f.created_by),
  paidBy: strOpt(f.paid_by),
  recurringId: strOpt(f.recurring_id),
  budgetId: strOpt(f.budget_id),
  createdAt: int(f.created_at),
  updatedAt: int(f.updated_at),
  entityId: strOpt(f.entity_id),
});

export const aBudget = (f: Fila): Budget => ({
  id: str(f.id),
  householdId: str(f.household_id),
  categoryId: strOpt(f.category_id),
  amountMinor: int(f.amount_minor),
  period: str(f.period),
  name: strOpt(f.name),
  closedAt: intOpt(f.closed_at),
  icon: strOpt(f.icon),
  createdAt: int(f.created_at),
  updatedAt: int(f.updated_at),
  entityId: strOpt(f.entity_id),
});

export const aMember = (f: Fila): Member => ({
  id: str(f.id),
  householdId: str(f.household_id),
  email: str(f.email),
  displayName: str(f.display_name),
  color: str(f.color),
  emoji: str(f.emoji),
  homeLayout: aSecciones(f.home_layout, SECCIONES_INICIO),
  movesLayout: aSecciones(f.moves_layout, SECCIONES_MOVIMIENTOS),
  theme: TEMAS.includes(f.theme as Tema) ? (f.theme as Tema) : 'auto',
  photo: str(f.photo),
  createdAt: int(f.created_at),
});

/**
 * El orden del Inicio se guarda como JSON en una columna de texto.
 *
 * Se filtra contra la lista conocida en vez de confiar en lo guardado: si
 * algun dia se renombra o se quita una seccion, los ordenes viejos siguen
 * siendo utiles en lugar de romper la pantalla con una seccion fantasma.
 */
function aSecciones<T extends string>(v: unknown, validas: readonly T[]): T[] {
  if (typeof v !== 'string' || v === '') return [];
  try {
    const datos = JSON.parse(v);
    if (!Array.isArray(datos)) return [];
    return datos.filter((x): x is T =>
      typeof x === 'string' && (validas as readonly string[]).includes(x));
  } catch {
    return [];
  }
}

export const aRecurring = (f: Fila): Recurring => ({
  id: str(f.id),
  householdId: str(f.household_id),
  name: str(f.name),
  type: int(f.type) as TxType,
  amountMinor: int(f.amount_minor),
  accountId: str(f.account_id),
  categoryId: strOpt(f.category_id),
  jarId: strOpt(f.jar_id),
  distributeToJars: bool(f.distribute_to_jars),
  paidBy: strOpt(f.paid_by),
  frequency: (['semanal', 'quincenal', 'mensual', 'anual'] as const).includes(f.frequency as 'mensual')
    ? (f.frequency as 'semanal' | 'quincenal' | 'mensual' | 'anual')
    : 'mensual',
  dayOfMonth: intOpt(f.day_of_month),
  dayOfMonth2: intOpt(f.day_of_month_2),
  dayOfWeek: intOpt(f.day_of_week),
  monthOfYear: intOpt(f.month_of_year),
  active: bool(f.active),
  nextRun: int(f.next_run),
  lastRun: intOpt(f.last_run),
  esperandoDesde: intOpt(f.esperando_desde),
  createdAt: int(f.created_at),
  updatedAt: int(f.updated_at),
  entityId: strOpt(f.entity_id),
});

export const aAdjustment = (f: Fila): Adjustment => ({
  id: str(f.id),
  householdId: str(f.household_id),
  accountId: str(f.account_id),
  memberId: strOpt(f.member_id),
  fromMinor: int(f.from_minor),
  toMinor: int(f.to_minor),
  deltaMinor: int(f.delta_minor),
  note: strOpt(f.note),
  createdAt: int(f.created_at),
});

export const aHousehold = (f: Fila): Household => ({
  id: str(f.id),
  name: str(f.name),
  currency: str(f.currency),
  createdAt: int(f.created_at),
});

// --- consultas -----------------------------------------------------------

/**
 * Lo que los movimientos le suman o restan a una cuenta.
 *
 * Los numeros de tipo (1 ajuste, 2 ingreso, 3 gasto, 4 transferencia) son los
 * de TxType en shared/types.ts, y el signo de cada caso replica exactamente el
 * de `efectoEnCuenta`. Los dos lugares tienen que decir lo mismo; el test
 * 'calcularSaldos' cubre la version de TypeScript.
 *
 * Es una funcion y se exporta porque el ajuste manual de saldo necesita
 * exactamente esta cuenta para despejar el saldo inicial. Tenerla escrita dos
 * veces no era una duplicacion inofensiva: la primera copia ya se habia
 * olvidado el COALESCE de la pata de entrada de las transferencias, y el
 * ajuste habria quedado corrido por el monto de cada transferencia recibida.
 */
export const sumaDeMovimientos = (cuenta: string): string => `
    COALESCE((
        SELECT SUM(CASE
          WHEN t.type = 2 THEN  t.amount_minor
          WHEN t.type = 3 THEN -t.amount_minor
          WHEN t.type = 1 THEN  t.amount_minor
          WHEN t.type = 4 THEN -t.amount_minor
          ELSE 0 END)
        FROM tx t WHERE t.account_id = ${cuenta}
      ), 0)
    + COALESCE((
        SELECT SUM(COALESCE(t.dest_amount_minor, t.amount_minor))
        FROM tx t WHERE t.dest_account_id = ${cuenta} AND t.type = 4
      ), 0)`;

/** Cuentas con el saldo ya calculado. */
const SQL_CUENTAS = `
  SELECT a.*,
    a.initial_balance_minor + ${sumaDeMovimientos('a.id')}
    AS balance_minor
  FROM account a
  WHERE a.household_id = ?1
  ORDER BY a.archived ASC, a.display_order ASC, a.created_at ASC`;

export async function listarCuentas(env: Env, householdId: string): Promise<Account[]> {
  const { results } = await env.DB.prepare(SQL_CUENTAS).bind(householdId).all<Fila>();
  return results.map(aAccount);
}

export async function cuentaPorId(
  env: Env, householdId: string, id: string,
): Promise<Account | null> {
  const fila = await env.DB.prepare(
    `${SQL_CUENTAS.replace('WHERE a.household_id = ?1', 'WHERE a.household_id = ?1 AND a.id = ?2')}`,
  ).bind(householdId, id).first<Fila>();
  return fila ? aAccount(fila) : null;
}

export async function listarCategorias(env: Env, householdId: string): Promise<Category[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM category WHERE household_id = ?1
      ORDER BY archived ASC, type ASC, display_order ASC, created_at ASC`,
  ).bind(householdId).all<Fila>();
  return results.map(aCategory);
}

export async function listarRecurrentes(env: Env, householdId: string): Promise<Recurring[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM recurring WHERE household_id = ?1 ORDER BY active DESC, next_run ASC',
  ).bind(householdId).all<Fila>();
  return results.map(aRecurring);
}

export async function recurrentePorId(
  env: Env, householdId: string, id: string,
): Promise<Recurring | null> {
  const fila = await env.DB.prepare('SELECT * FROM recurring WHERE household_id = ?1 AND id = ?2')
    .bind(householdId, id).first<Fila>();
  return fila ? aRecurring(fila) : null;
}

export async function listarPresupuestos(env: Env, householdId: string): Promise<Budget[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM budget WHERE household_id = ?1 ORDER BY period DESC',
  ).bind(householdId).all<Fila>();
  return results.map(aBudget);
}

export async function listarMiembros(env: Env, householdId: string): Promise<Member[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM member WHERE household_id = ?1 ORDER BY created_at ASC',
  ).bind(householdId).all<Fila>();
  return results.map(aMember);
}

/**
 * Movimientos, mas nuevos primero.
 *
 * El limite por defecto es alto a proposito: con el volumen de una pareja
 * (unos cientos por año) entra todo el historial en memoria del cliente, que
 * asi puede filtrar, agrupar y graficar sin volver a pedir nada. Si algun dia
 * crece, el parametro ya esta.
 */
export async function listarMovimientos(
  env: Env, householdId: string, limite = 2000, desde?: number,
): Promise<Transaction[]> {
  const sql = desde
    ? 'SELECT * FROM tx WHERE household_id = ?1 AND date >= ?3 ORDER BY date DESC, created_at DESC LIMIT ?2'
    : 'SELECT * FROM tx WHERE household_id = ?1 ORDER BY date DESC, created_at DESC LIMIT ?2';

  const stmt = desde
    ? env.DB.prepare(sql).bind(householdId, limite, desde)
    : env.DB.prepare(sql).bind(householdId, limite);

  const { results } = await stmt.all<Fila>();
  return results.map(aTransaction);
}

export async function movimientoPorId(
  env: Env, householdId: string, id: string,
): Promise<Transaction | null> {
  const fila = await env.DB.prepare(
    'SELECT * FROM tx WHERE household_id = ?1 AND id = ?2',
  ).bind(householdId, id).first<Fila>();
  return fila ? aTransaction(fila) : null;
}

/**
 * Jarras con su saldo.
 *
 * A diferencia de las cuentas, esto no se puede hacer en SQL puro: el reparto
 * por mayor resto necesita ver todas las jarras juntas para decidir a quien le
 * tocan los centavos sobrantes. Se usa la MISMA funcion que el cliente
 * (shared/domain.ts), asi que los dos llegan siempre al mismo numero.
 */
export async function listarEntidades(env: Env, householdId: string): Promise<Entity[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM entity WHERE household_id = ?1 ORDER BY display_order ASC, created_at ASC',
  ).bind(householdId).all<Fila>();
  return results.map(aEntity);
}

export async function listarImputaciones(
  env: Env, householdId: string,
): Promise<JarImputacion[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM jar_imputacion WHERE household_id = ?1',
  ).bind(householdId).all<Fila>();
  return results.map(aJarImputacion);
}

export async function listarTraspasos(
  env: Env, householdId: string,
): Promise<JarTransfer[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM jar_transfer WHERE household_id = ?1 ORDER BY date DESC, created_at DESC',
  ).bind(householdId).all<Fila>();
  return results.map(aJarTransfer);
}

export async function listarAportes(env: Env, householdId: string): Promise<JarAporte[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM jar_aporte WHERE household_id = ?1 ORDER BY date DESC, created_at DESC',
  ).bind(householdId).all<Fila>();
  return results.map(aJarAporte);
}

/**
 * Jarras con su saldo de toda la vida.
 *
 * El saldo sale de las imputaciones congeladas, no de recalcular el historial
 * con los porcentajes de hoy. Ese es el punto de la migracion 0004.
 */
export async function listarJarras(
  env: Env,
  householdId: string,
  imputaciones?: JarImputacion[],
  transfers?: JarTransfer[],
  aportes?: JarAporte[],
): Promise<Jar[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM jar WHERE household_id = ?1 ORDER BY display_order ASC, created_at ASC',
  ).bind(householdId).all<Fila>();

  const jarras = results.map(aJar);
  if (jarras.length === 0) return jarras;

  const [imp, tra, apo] = await Promise.all([
    imputaciones ?? listarImputaciones(env, householdId),
    transfers ?? listarTraspasos(env, householdId),
    aportes ?? listarAportes(env, householdId),
  ]);
  const saldos = calcularJarras(jarras, imp, tra, apo);

  return jarras.map((j) => ({ ...j, balanceMinor: saldos.get(j.id) ?? 0 }));
}

/** Todo lo que el cliente necesita para arrancar, en un solo viaje. */
export async function snapshot(
  env: Env, householdId: string, memberId: string,
): Promise<Snapshot | null> {
  const filaHogar = await env.DB.prepare('SELECT * FROM household WHERE id = ?1')
    .bind(householdId).first<Fila>();
  if (!filaHogar) return null;

  const [accounts, categories, budgets, members, transactions, recurring,
         imputaciones, jarTransfers, entities, jarAportes] = await Promise.all([
    listarCuentas(env, householdId),
    listarCategorias(env, householdId),
    listarPresupuestos(env, householdId),
    listarMiembros(env, householdId),
    listarMovimientos(env, householdId),
    listarRecurrentes(env, householdId),
    listarImputaciones(env, householdId),
    listarTraspasos(env, householdId),
    listarEntidades(env, householdId),
    listarAportes(env, householdId),
  ]);

  // Se reusa lo ya traido en vez de volver a consultarlo.
  const jars = await listarJarras(env, householdId, imputaciones, jarTransfers, jarAportes);

  const me = members.find((m) => m.id === memberId);
  if (!me) return null;

  return {
    household: aHousehold(filaHogar),
    members, me, accounts, categories, jars, budgets, transactions, recurring,
    imputaciones, jarTransfers, entities, jarAportes,
  };
}
