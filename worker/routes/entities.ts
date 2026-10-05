/**
 * Entidades: la casa y los negocios.
 *
 * Un solo libro con tres dueños del dinero. No son tres hogares ni tres apps:
 * lo valioso es justamente poder cruzarlos y ver el consolidado.
 */

import type { Sesion } from '../auth.ts';
import { aEntity, listarEntidades } from '../db.ts';
import type { Env } from '../env.ts';
import {
  ahora, booleano, color, cuerpo, difundir, entero, error, idOpcional, json,
  nuevoId, texto, unoDe,
} from '../http.ts';

const TIPOS = ['personal', 'negocio'] as const;
const MAX = 12;

export const listar = async (_r: Request, env: Env, s: Sesion) =>
  json({ entities: await listarEntidades(env, s.householdId) });

export async function crear(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);

  const cuantas = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM entity WHERE household_id = ?1',
  ).bind(sesion.householdId).first<{ n: number }>();
  if ((cuantas?.n ?? 0) >= MAX) return error(`Como máximo ${MAX} entidades`, 400);

  const name = texto(body.name, 'name', { max: 60, min: 1 });
  const kind = unoDe(body.kind ?? 'negocio', TIPOS, 'kind');
  const id = idOpcional(body.id, 'id') ?? nuevoId();
  const t = ahora();

  await env.DB.prepare(
    `INSERT INTO entity (id, household_id, name, kind, color, icon, display_order, archived, created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,0,?8)`,
  ).bind(
    id, sesion.householdId, name, kind,
    color(body.color, kind === 'negocio' ? '#9a6a06' : '#14655a'),
    texto(body.icon ?? (kind === 'negocio' ? 'briefcase' : 'house'), 'icon', { max: 40 }),
    entero(body.displayOrder ?? (cuantas?.n ?? 0), 'displayOrder', { min: 0, max: 999 }),
    t,
  ).run();

  const fila = await env.DB.prepare('SELECT * FROM entity WHERE id = ?1').bind(id)
    .first<Record<string, unknown>>();
  if (!fila) return error('No se pudo crear la entidad', 500);
  const entity = aEntity(fila);

  await difundir(env, sesion.householdId, { kind: 'entity:upsert', entity, by: sesion.memberId });
  return json({ entity }, { status: 201 });
}

export async function editar(
  req: Request, env: Env, sesion: Sesion, id: string,
): Promise<Response> {
  const filaActual = await env.DB.prepare(
    'SELECT * FROM entity WHERE id = ?1 AND household_id = ?2',
  ).bind(id, sesion.householdId).first<Record<string, unknown>>();
  if (!filaActual) return error('La entidad no existe', 404);
  const actual = aEntity(filaActual);

  const body = await cuerpo(req);

  await env.DB.prepare(
    `UPDATE entity SET name=?1, kind=?2, color=?3, icon=?4, display_order=?5, archived=?6
     WHERE id=?7 AND household_id=?8`,
  ).bind(
    texto(body.name ?? actual.name, 'name', { max: 60, min: 1 }),
    unoDe(body.kind ?? actual.kind, TIPOS, 'kind'),
    color(body.color, actual.color),
    texto(body.icon ?? actual.icon, 'icon', { max: 40 }),
    entero(body.displayOrder ?? actual.displayOrder, 'displayOrder', { min: 0, max: 999 }),
    booleano(body.archived ?? actual.archived) ? 1 : 0,
    id, sesion.householdId,
  ).run();

  const fila = await env.DB.prepare('SELECT * FROM entity WHERE id = ?1').bind(id)
    .first<Record<string, unknown>>();
  if (!fila) return error('No se pudo actualizar', 500);
  const entity = aEntity(fila);

  await difundir(env, sesion.householdId, { kind: 'entity:upsert', entity, by: sesion.memberId });
  return json({ entity });
}

/**
 * Borrar una entidad se lleva sus jarras y sus presupuestos por delante
 * (ON DELETE CASCADE), asi que por defecto se archiva. Archivada deja de
 * aparecer en el selector pero su historia sigue entera.
 */
export async function borrar(
  req: Request, env: Env, sesion: Sesion, id: string,
): Promise<Response> {
  const definitivo = new URL(req.url).searchParams.get('purge') === '1';

  if (!definitivo) {
    await env.DB.prepare('UPDATE entity SET archived = 1 WHERE id = ?1 AND household_id = ?2')
      .bind(id, sesion.householdId).run();
    const fila = await env.DB.prepare('SELECT * FROM entity WHERE id = ?1').bind(id)
      .first<Record<string, unknown>>();
    if (!fila) return error('La entidad no existe', 404);
    const entity = aEntity(fila);
    await difundir(env, sesion.householdId, { kind: 'entity:upsert', entity, by: sesion.memberId });
    return json({ ok: true, entity });
  }

  const { meta } = await env.DB.prepare('DELETE FROM entity WHERE id = ?1 AND household_id = ?2')
    .bind(id, sesion.householdId).run();
  if (!meta.changes) return error('La entidad no existe', 404);

  // Las categorias y los movimientos se quedan, solo pierden el dueño
  // (ON DELETE SET NULL): se pierde la clasificacion, nunca el movimiento.
  await difundir(env, sesion.householdId, { kind: 'entity:delete', id, by: sesion.memberId });
  return json({ ok: true });
}
