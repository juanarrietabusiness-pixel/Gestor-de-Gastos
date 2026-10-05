/**
 * Alta, edicion y baja de movimientos.
 *
 * Al terminar cada mutacion se difunde por el Durable Object, asi el otro
 * telefono lo ve aparecer sin refrescar.
 */

import type { Sesion } from '../auth.ts';
import { aTransaction, cuentaPorId, listarCuentas, listarJarras, listarMovimientos, movimientoPorId } from '../db.ts';
import {
  ambitoDeReparto, imputacionesDe, mismoReparto, sentenciasImputacion,
} from '../jarras.ts';
import type { Env } from '../env.ts';
import {
  ahora, booleano, cuerpo, difundir, entero, error, idOpcional, json,
  nuevoId, texto, textoOpcional, unoDe,
} from '../http.ts';
import { TxType } from '../../shared/types.ts';
import type { Transaction } from '../../shared/types.ts';

const TIPOS = [TxType.AJUSTE, TxType.INGRESO, TxType.GASTO, TxType.TRANSFERENCIA] as const;

/** Tope de un billon de centavos: atrapa un cero de mas antes de guardarlo. */
const MAX_MONTO = 999_999_999_999;

interface Validado {
  type: TxType;
  amountMinor: number;
  accountId: string;
  destAccountId: string | null;
  destAmountMinor: number | null;
  categoryId: string | null;
  jarId: string | null;
  budgetId: string | null;
  distributeToJars: boolean;
  description: string;
  notes: string | null;
  date: number;
  paidBy: string | null;
  /** NULL = la de su categoria. Solo se escribe al corregir uno suelto. */
  entityId: string | null;
}

async function validar(
  body: Record<string, unknown>, env: Env, householdId: string,
): Promise<Validado | Response> {
  const type = unoDe(body.type, TIPOS, 'type');

  // Un ajuste puede ser negativo (el saldo real era menor). Los demas tipos
  // llevan el signo en el tipo, no en el monto.
  const amountMinor = type === TxType.AJUSTE
    ? entero(body.amountMinor, 'amountMinor', { min: -MAX_MONTO, max: MAX_MONTO })
    : entero(body.amountMinor, 'amountMinor', { min: 1, max: MAX_MONTO });

  const accountId = texto(body.accountId, 'accountId', { max: 64, min: 1 });
  const destAccountId = idOpcional(body.destAccountId, 'destAccountId');

  // Que las cuentas existan y sean de este hogar: sin esto, alguien podria
  // mandar el id de una cuenta ajena.
  const origen = await cuentaPorId(env, householdId, accountId);
  if (!origen) return error('La cuenta de origen no existe', 404);

  if (type === TxType.TRANSFERENCIA) {
    if (!destAccountId) return error('Una transferencia necesita cuenta de destino', 400);
    if (destAccountId === accountId) {
      return error('El origen y el destino no pueden ser la misma cuenta', 400);
    }
    const destino = await cuentaPorId(env, householdId, destAccountId);
    if (!destino) return error('La cuenta de destino no existe', 404);
  }

  // Solo hace falta un monto de destino distinto si las monedas difieren.
  let destAmountMinor: number | null = null;
  if (type === TxType.TRANSFERENCIA && body.destAmountMinor !== null && body.destAmountMinor !== undefined) {
    destAmountMinor = entero(body.destAmountMinor, 'destAmountMinor', { min: 1, max: MAX_MONTO });
  }

  const categoryId = idOpcional(body.categoryId, 'categoryId');
  if (categoryId) {
    const cat = await env.DB.prepare('SELECT id FROM category WHERE id = ?1 AND household_id = ?2')
      .bind(categoryId, householdId).first();
    if (!cat) return error('La categoría no existe', 404);
  }

  const jarId = idOpcional(body.jarId, 'jarId');
  if (jarId) {
    const jar = await env.DB.prepare('SELECT id FROM jar WHERE id = ?1 AND household_id = ?2')
      .bind(jarId, householdId).first();
    if (!jar) return error('La jarra no existe', 404);
  }

  const distributeToJars = booleano(body.distributeToJars);
  if (distributeToJars && type !== TxType.INGRESO) {
    return error('Solo un ingreso se puede repartir entre las jarras', 400);
  }
  if (distributeToJars && jarId) {
    return error('Un ingreso se reparte entre todas las jarras o va a una sola, no ambas', 400);
  }

  const date = entero(body.date, 'date', { min: 0, max: 4_102_444_800_000 });

  // Quien hizo el gasto, que puede no ser quien lo esta cargando.
  const entityId = idOpcional(body.entityId, 'entityId');
  if (entityId) {
    const e = await env.DB.prepare('SELECT id FROM entity WHERE id = ?1 AND household_id = ?2')
      .bind(entityId, householdId).first();
    if (!e) return error('Esa entidad no existe', 404);
  }

  const paidBy = idOpcional(body.paidBy, 'paidBy');
  if (paidBy) {
    const m = await env.DB.prepare('SELECT id FROM member WHERE id = ?1 AND household_id = ?2')
      .bind(paidBy, householdId).first();
    if (!m) return error('Esa persona no pertenece al hogar', 400);
  }

  // A que evento cuenta este gasto. Se comprueba que exista y que sea de este
  // hogar: sin esto un id inventado dejaria el gasto apuntando a la nada.
  const budgetId = idOpcional(body.budgetId, 'budgetId');
  if (budgetId) {
    const b = await env.DB.prepare('SELECT id FROM budget WHERE id = ?1 AND household_id = ?2')
      .bind(budgetId, householdId).first();
    if (!b) return error('Ese presupuesto no existe', 404);
  }

  return {
    type, amountMinor, accountId, destAccountId, destAmountMinor, categoryId,
    jarId, budgetId, distributeToJars, paidBy, entityId,
    description: texto(body.description ?? '', 'description', { max: 200 }),
    notes: textoOpcional(body.notes, 'notes', 2000),
    date,
  };
}

export async function listar(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const url = new URL(req.url);
  const limite = Math.min(Number(url.searchParams.get('limit') ?? 2000) || 2000, 5000);
  const desde = url.searchParams.get('since');

  const movs = await listarMovimientos(
    env, sesion.householdId, limite, desde ? Number(desde) : undefined,
  );
  return json({ transactions: movs });
}

export async function crear(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);
  const v = await validar(body, env, sesion.householdId);
  if (v instanceof Response) return v;

  const t = ahora();
  // El cliente puede proponer el id para que su version optimista y la real
  // sean la misma fila, sin parpadeo ni duplicados si se reintenta.
  const id = idOpcional(body.id, 'id') ?? nuevoId();

  // Un cobro de un negocio se reparte entre las jarras de ese negocio, no
  // entre los frascos de la casa. El ambito resuelve de quien es.
  const ambito = await ambitoDeReparto(env, sesion.householdId);

  // El movimiento y su reparto van juntos: si algo falla no queda un ingreso
  // que las jarras no vieron.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tx (id, household_id, type, amount_minor, account_id, dest_account_id,
                       dest_amount_minor, category_id, jar_id, distribute_to_jars,
                       description, notes, date, created_by, paid_by, entity_id,
                       budget_id, created_at, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?18,?17,?17)`,
    ).bind(
      id, sesion.householdId, v.type, v.amountMinor, v.accountId, v.destAccountId,
      v.destAmountMinor, v.categoryId, v.jarId, v.distributeToJars ? 1 : 0,
      v.description, v.notes, v.date, sesion.memberId, v.paidBy, v.entityId, t,
      v.budgetId,
    ),
    ...sentenciasImputacion(env, sesion.householdId, id, v, ambito.jarrasPara(v), t),
  ]);

  const tx = await movimientoPorId(env, sesion.householdId, id);
  if (!tx) return error('No se pudo guardar el movimiento', 500);

  const imputaciones = await imputacionesDe(env, id);
  await difundir(env, sesion.householdId, { kind: 'tx:upsert', tx, by: sesion.memberId });
  if (imputaciones.length) {
    await difundir(env, sesion.householdId, {
      kind: 'imputaciones', txId: id, imputaciones, by: sesion.memberId,
    });
  }
  return json(
    { transaction: tx, imputaciones, ...(await saldosFrescos(env, sesion.householdId)) },
    { status: 201 },
  );
}

export async function editar(
  req: Request, env: Env, sesion: Sesion, id: string,
): Promise<Response> {
  const existente = await movimientoPorId(env, sesion.householdId, id);
  if (!existente) return error('El movimiento no existe', 404);

  const body = await cuerpo(req);
  const v = await validar(body, env, sesion.householdId);
  if (v instanceof Response) return v;

  const t = ahora();
  const actualizar = env.DB.prepare(
    `UPDATE tx SET type=?1, amount_minor=?2, account_id=?3, dest_account_id=?4,
                   dest_amount_minor=?5, category_id=?6, jar_id=?7, distribute_to_jars=?8,
                   description=?9, notes=?10, date=?11, paid_by=?12, entity_id=?13,
                   budget_id=?17, updated_at=?14
     WHERE id=?15 AND household_id=?16`,
  ).bind(
    v.type, v.amountMinor, v.accountId, v.destAccountId, v.destAmountMinor,
    v.categoryId, v.jarId, v.distributeToJars ? 1 : 0, v.description, v.notes,
    v.date, v.paidBy, v.entityId, t, id, sesion.householdId, v.budgetId,
  );

  // Solo se vuelve a congelar si de verdad cambio el reparto. Corregir una
  // descripcion o mover la fecha no puede repartir de nuevo con los
  // porcentajes de hoy: eso reescribiria en silencio un reparto viejo.
  const cambio = !mismoReparto(existente, v);
  if (cambio) {
    const ambito = await ambitoDeReparto(env, sesion.householdId);
    await env.DB.batch([
      actualizar,
      ...sentenciasImputacion(env, sesion.householdId, id, v, ambito.jarrasPara(v), t),
    ]);
  } else {
    await actualizar.run();
  }

  const tx = await movimientoPorId(env, sesion.householdId, id);
  if (!tx) return error('No se pudo actualizar', 500);

  const imputaciones = await imputacionesDe(env, id);
  await difundir(env, sesion.householdId, { kind: 'tx:upsert', tx, by: sesion.memberId });
  if (cambio) {
    await difundir(env, sesion.householdId, {
      kind: 'imputaciones', txId: id, imputaciones, by: sesion.memberId,
    });
  }
  return json({ transaction: tx, imputaciones, ...(await saldosFrescos(env, sesion.householdId)) });
}

export async function borrar(
  _req: Request, env: Env, sesion: Sesion, id: string,
): Promise<Response> {
  const { meta } = await env.DB.prepare('DELETE FROM tx WHERE id = ?1 AND household_id = ?2')
    .bind(id, sesion.householdId).run();

  if (!meta.changes) return error('El movimiento no existe', 404);

  await difundir(env, sesion.householdId, { kind: 'tx:delete', id, by: sesion.memberId });
  return json({ ok: true, ...(await saldosFrescos(env, sesion.householdId)) });
}

/**
 * Cuentas y jarras recalculadas, que viajan con la respuesta de cada mutacion.
 * Asi el cliente no tiene que pedirlas aparte y los saldos que muestra son
 * siempre los del servidor, no una estimacion propia.
 */
async function saldosFrescos(env: Env, householdId: string) {
  const [accounts, jars] = await Promise.all([
    listarCuentas(env, householdId),
    listarJarras(env, householdId),
  ]);
  return { accounts, jars };
}

/** Alta en lote, para vaciar la cola de cambios hechos sin conexion. */
export async function crearLote(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);
  const items = Array.isArray(body.transactions) ? body.transactions : [];

  if (items.length === 0) return error('No hay movimientos para guardar', 400);
  if (items.length > 100) return error('Como máximo 100 movimientos por lote', 400);

  const guardados: Transaction[] = [];
  const rechazados: { indice: number; motivo: string }[] = [];
  const t = ahora();
  // Una sola lectura de jarras, categorias y entidades para todo el lote: no
  // cambian en el medio.
  const ambito = await ambitoDeReparto(env, sesion.householdId);

  for (const [i, item] of items.entries()) {
    if (typeof item !== 'object' || item === null) {
      rechazados.push({ indice: i, motivo: 'No es un objeto' });
      continue;
    }

    const body2 = item as Record<string, unknown>;
    const v = await validar(body2, env, sesion.householdId);
    if (v instanceof Response) {
      rechazados.push({ indice: i, motivo: await v.clone().text() });
      continue;
    }

    const id = idOpcional(body2.id, 'id') ?? nuevoId();

    // INSERT OR IGNORE: si el mismo movimiento ya entro en un reintento
    // anterior, no se duplica. Sus imputaciones se reescriben igual, que es
    // idempotente porque el id de cada una sale de txId y jarId.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO tx (id, household_id, type, amount_minor, account_id, dest_account_id,
                        dest_amount_minor, category_id, jar_id, distribute_to_jars,
                        description, notes, date, created_by, paid_by, entity_id,
                        created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?17)`,
      ).bind(
        id, sesion.householdId, v.type, v.amountMinor, v.accountId, v.destAccountId,
        v.destAmountMinor, v.categoryId, v.jarId, v.distributeToJars ? 1 : 0,
        v.description, v.notes, v.date, sesion.memberId, v.paidBy, v.entityId, t,
      ),
      ...sentenciasImputacion(env, sesion.householdId, id, v, ambito.jarrasPara(v), t),
    ]);

    const fila = await env.DB.prepare('SELECT * FROM tx WHERE id = ?1').bind(id).first<Record<string, unknown>>();
    if (fila) {
      const tx = aTransaction(fila);
      guardados.push(tx);
      await difundir(env, sesion.householdId, { kind: 'tx:upsert', tx, by: sesion.memberId });
      const imp = await imputacionesDe(env, id);
      if (imp.length) {
        await difundir(env, sesion.householdId, {
          kind: 'imputaciones', txId: id, imputaciones: imp, by: sesion.memberId,
        });
      }
    }
  }

  return json({ transactions: guardados, rechazados, ...(await saldosFrescos(env, sesion.householdId)) });
}
