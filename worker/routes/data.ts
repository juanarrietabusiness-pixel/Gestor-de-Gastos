/**
 * Cuentas, categorias, jarras y presupuestos.
 */

import type { Sesion } from '../auth.ts';
import {
  aBudget, aCategory, aMember, cuentaPorId, listarCategorias, listarCuentas,
  listarJarras, listarPresupuestos, snapshot,
} from '../db.ts';
import type { Env } from '../env.ts';
import {
  ahora, booleano, color, cuerpo, difundir, entero, error, idOpcional,
  json, nuevoId, periodo, texto, unoDe,
} from '../http.ts';
import {
  AccountCategory, SECCIONES_INICIO, SECCIONES_MOVIMIENTOS, TEMAS, type Jar,
} from '../../shared/types.ts';
import { validarJarras } from '../../shared/domain.ts';

const CATEGORIAS_CUENTA = Object.values(AccountCategory);
const FORMAS_DE_LLENAR = ['porcentaje', 'fijo', 'resto'] as const;

// --- snapshot ------------------------------------------------------------

export async function traerTodo(_req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const snap = await snapshot(env, sesion.householdId, sesion.memberId);
  if (!snap) return error('No se encontro el hogar', 404);
  return json(snap);
}

// --- cuentas -------------------------------------------------------------

export async function crearCuenta(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);

  const name = texto(body.name, 'name', { max: 60, min: 1 });
  const category = unoDe(body.category, CATEGORIAS_CUENTA, 'category');
  const currency = texto(body.currency ?? 'USD', 'currency', { max: 3, min: 3 }).toUpperCase();
  const initialBalanceMinor = entero(body.initialBalanceMinor ?? 0, 'initialBalanceMinor', {
    min: -999_999_999_999, max: 999_999_999_999,
  });
  const owner = texto(body.owner ?? 'compartida', 'owner', { max: 64, min: 1 });

  // El dueño es 'compartida' o una persona real del hogar.
  if (owner !== 'compartida') {
    const m = await env.DB.prepare('SELECT id FROM member WHERE id = ?1 AND household_id = ?2')
      .bind(owner, sesion.householdId).first();
    if (!m) return error('El dueño de la cuenta no pertenece al hogar', 400);
  }

  const t = ahora();
  const id = idOpcional(body.id, 'id') ?? nuevoId();

  await env.DB.prepare(
    `INSERT INTO account (id, household_id, name, category, currency, initial_balance_minor,
                          color, icon, owner, archived, display_order, created_at, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?11,?11)`,
  ).bind(
    id, sesion.householdId, name, category, currency, initialBalanceMinor,
    color(body.color, '#10b981'), texto(body.icon ?? 'wallet', 'icon', { max: 40 }),
    owner, entero(body.displayOrder ?? 0, 'displayOrder', { min: 0, max: 9999 }), t,
  ).run();

  const account = await cuentaPorId(env, sesion.householdId, id);
  if (!account) return error('No se pudo crear la cuenta', 500);

  await difundir(env, sesion.householdId, { kind: 'account:upsert', account, by: sesion.memberId });
  return json({ account }, { status: 201 });
}

export async function editarCuenta(
  req: Request, env: Env, sesion: Sesion, id: string,
): Promise<Response> {
  const existente = await cuentaPorId(env, sesion.householdId, id);
  if (!existente) return error('La cuenta no existe', 404);

  const body = await cuerpo(req);

  const name = texto(body.name ?? existente.name, 'name', { max: 60, min: 1 });
  const category = unoDe(body.category ?? existente.category, CATEGORIAS_CUENTA, 'category');
  const initialBalanceMinor = entero(
    body.initialBalanceMinor ?? existente.initialBalanceMinor, 'initialBalanceMinor',
    { min: -999_999_999_999, max: 999_999_999_999 },
  );
  const owner = texto(body.owner ?? existente.owner, 'owner', { max: 64, min: 1 });

  if (owner !== 'compartida') {
    const m = await env.DB.prepare('SELECT id FROM member WHERE id = ?1 AND household_id = ?2')
      .bind(owner, sesion.householdId).first();
    if (!m) return error('El dueño de la cuenta no pertenece al hogar', 400);
  }

  await env.DB.prepare(
    `UPDATE account SET name=?1, category=?2, initial_balance_minor=?3, color=?4,
                        icon=?5, owner=?6, archived=?7, display_order=?8, updated_at=?9
     WHERE id=?10 AND household_id=?11`,
  ).bind(
    name, category, initialBalanceMinor, color(body.color, existente.color),
    texto(body.icon ?? existente.icon, 'icon', { max: 40 }), owner,
    booleano(body.archived ?? existente.archived) ? 1 : 0,
    entero(body.displayOrder ?? existente.displayOrder, 'displayOrder', { min: 0, max: 9999 }),
    ahora(), id, sesion.householdId,
  ).run();

  const account = await cuentaPorId(env, sesion.householdId, id);
  if (!account) return error('No se pudo actualizar la cuenta', 500);

  await difundir(env, sesion.householdId, { kind: 'account:upsert', account, by: sesion.memberId });
  return json({ account });
}

/**
 * Borrar una cuenta se lleva sus movimientos por delante (ON DELETE CASCADE).
 * Por eso hay que pedirlo explicitamente: por defecto se archiva, que conserva
 * el historial y la saca de las pantallas.
 */
export async function borrarCuenta(
  req: Request, env: Env, sesion: Sesion, id: string,
): Promise<Response> {
  const url = new URL(req.url);
  const definitivo = url.searchParams.get('purge') === '1';

  const cuenta = await cuentaPorId(env, sesion.householdId, id);
  if (!cuenta) return error('La cuenta no existe', 404);

  if (!definitivo) {
    await env.DB.prepare('UPDATE account SET archived = 1, updated_at = ?1 WHERE id = ?2 AND household_id = ?3')
      .bind(ahora(), id, sesion.householdId).run();

    const account = await cuentaPorId(env, sesion.householdId, id);
    if (account) {
      await difundir(env, sesion.householdId, { kind: 'account:upsert', account, by: sesion.memberId });
    }
    return json({ ok: true, archivada: true, account });
  }

  const { total } = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM tx WHERE account_id = ?1 OR dest_account_id = ?1',
  ).bind(id).first<{ total: number }>() ?? { total: 0 };

  await env.DB.prepare('DELETE FROM account WHERE id = ?1 AND household_id = ?2')
    .bind(id, sesion.householdId).run();

  await difundir(env, sesion.householdId, { kind: 'account:delete', id, by: sesion.memberId });
  return json({ ok: true, archivada: false, movimientosBorrados: total });
}

// --- categorias ----------------------------------------------------------

export async function crearCategoria(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);

  const name = texto(body.name, 'name', { max: 60, min: 1 });
  const type = unoDe(body.type, ['ingreso', 'gasto'] as const, 'type');
  const parentId = idOpcional(body.parentId, 'parentId');

  if (parentId) {
    const padre = await env.DB.prepare(
      'SELECT id, type, parent_id FROM category WHERE id = ?1 AND household_id = ?2',
    ).bind(parentId, sesion.householdId).first<{ type: string; parent_id: string | null }>();

    if (!padre) return error('La categoría padre no existe', 404);
    if (padre.type !== type) return error('La subcategoría debe ser del mismo tipo que su padre', 400);
    // Dos niveles y nada mas, como ezBookkeeping. Sin esto se arma un arbol
    // que ninguna pantalla sabe dibujar.
    if (padre.parent_id) return error('Solo se admiten dos niveles de categoría', 400);
  }

  const t = ahora();
  const id = idOpcional(body.id, 'id') ?? nuevoId();

  // Sin entidad explicita, la categoria nace en la primera economia —la casa—,
  // no en NULL. NULL significa "sin clasificar": la categoria no aparece bajo
  // ninguna economia, sus movimientos tampoco, y no hay nada en pantalla que
  // avise. Heredar de la subcategoria del padre cuando lo hay, que es lo que
  // uno espera.
  const entityId = idOpcional(body.entityId, 'entityId')
    ?? (parentId
      ? (await env.DB.prepare('SELECT entity_id FROM category WHERE id = ?1')
        .bind(parentId).first<{ entity_id: string | null }>())?.entity_id ?? null
      : null)
    ?? (await env.DB.prepare(
      `SELECT id FROM entity WHERE household_id = ?1 AND archived = 0
        ORDER BY display_order ASC, created_at ASC LIMIT 1`,
    ).bind(sesion.householdId).first<{ id: string }>())?.id
    ?? null;

  await env.DB.prepare(
    `INSERT INTO category (id, household_id, name, type, parent_id, icon, color,
                           archived, display_order, created_at, entity_id)
     VALUES (?1,?2,?3,?4,?5,?6,?7,0,?8,?9,?10)`,
  ).bind(
    id, sesion.householdId, name, type, parentId,
    texto(body.icon ?? 'tag', 'icon', { max: 40 }), color(body.color, '#64748b'),
    entero(body.displayOrder ?? 0, 'displayOrder', { min: 0, max: 9999 }), t,
    entityId,
  ).run();

  const fila = await env.DB.prepare('SELECT * FROM category WHERE id = ?1').bind(id)
    .first<Record<string, unknown>>();
  if (!fila) return error('No se pudo crear la categoría', 500);

  const category = aCategory(fila);
  await difundir(env, sesion.householdId, { kind: 'category:upsert', category, by: sesion.memberId });
  return json({ category }, { status: 201 });
}

export async function editarCategoria(
  req: Request, env: Env, sesion: Sesion, id: string,
): Promise<Response> {
  const fila0 = await env.DB.prepare('SELECT * FROM category WHERE id = ?1 AND household_id = ?2')
    .bind(id, sesion.householdId).first<Record<string, unknown>>();
  if (!fila0) return error('La categoría no existe', 404);

  const actual = aCategory(fila0);
  const body = await cuerpo(req);

  await env.DB.prepare(
    `UPDATE category SET name=?1, icon=?2, color=?3, archived=?4, display_order=?5,
                         entity_id=?6
     WHERE id=?7 AND household_id=?8`,
  ).bind(
    texto(body.name ?? actual.name, 'name', { max: 60, min: 1 }),
    texto(body.icon ?? actual.icon, 'icon', { max: 40 }),
    color(body.color, actual.color),
    booleano(body.archived ?? actual.archived) ? 1 : 0,
    entero(body.displayOrder ?? actual.displayOrder, 'displayOrder', { min: 0, max: 9999 }),
    // Cambiar esto reclasifica toda la historia de la categoria de una vez,
    // sin tocar un solo movimiento. Es el punto de tenerla aca.
    body.entityId === undefined ? actual.entityId : idOpcional(body.entityId, 'entityId'),
    id, sesion.householdId,
  ).run();

  const fila = await env.DB.prepare('SELECT * FROM category WHERE id = ?1').bind(id)
    .first<Record<string, unknown>>();
  if (!fila) return error('No se pudo actualizar', 500);

  const category = aCategory(fila);
  await difundir(env, sesion.householdId, { kind: 'category:upsert', category, by: sesion.memberId });
  return json({ category });
}

// --- jarras --------------------------------------------------------------

/**
 * Las jarras se guardan todas juntas, no de a una.
 *
 * El motivo es que los porcentajes tienen que sumar 100% para que el reparto
 * de un ingreso tenga sentido. Si se pudieran editar sueltas, entre una
 * escritura y otra el hogar quedaria con un reparto invalido. Mandando el
 * conjunto entero se valida una vez y se escribe en una transaccion.
 */
export async function guardarJarras(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);
  const items = Array.isArray(body.jars) ? body.jars : null;
  if (!items) return error('Se esperaba la lista completa de jarras', 400);
  if (items.length > 20) return error('Como máximo 20 jarras', 400);

  const jarras: Jar[] = [];
  const t = ahora();

  for (const [i, item] of items.entries()) {
    if (typeof item !== 'object' || item === null) return error(`La jarra ${i + 1} es invalida`, 400);
    const o = item as Record<string, unknown>;

    jarras.push({
      id: idOpcional(o.id, 'id') ?? nuevoId(),
      householdId: sesion.householdId,
      name: texto(o.name, 'name', { max: 60, min: 1 }),
      percentageBp: entero(o.percentageBp, 'percentageBp', { min: 0, max: 10_000 }),
      color: color(o.color, '#10b981'),
      icon: texto(o.icon ?? 'piggy-bank', 'icon', { max: 40 }),
      displayOrder: i,
      createdAt: t,
      acumula: booleano(o.acumula ?? false),
      entityId: idOpcional(o.entityId, 'entityId'),
      fillKind: unoDe(o.fillKind ?? 'porcentaje', FORMAS_DE_LLENAR, 'fillKind'),
      fillMinor: o.fillMinor === undefined || o.fillMinor === null
        ? null
        : entero(o.fillMinor, 'fillMinor', { min: 0, max: 999_999_999_999 }),
      balanceMinor: 0,
    });
  }

  // Se valida por entidad: cada economia tiene su propio 100%. Mezclar las
  // jarras de la casa con las de un negocio en una sola suma no querria decir
  // nada.
  const porEntidad = new Map<string, Jar[]>();
  for (const j of jarras) {
    const clave = j.entityId ?? '';
    porEntidad.set(clave, [...(porEntidad.get(clave) ?? []), j]);
  }
  for (const grupo of porEntidad.values()) {
    const { ok, sumaBp, motivo } = validarJarras(grupo);
    if (!ok) {
      return error(
        motivo ?? `Los porcentajes deben sumar 100%. Ahora suman ${(sumaBp / 100).toFixed(2)}%.`,
        400,
      );
    }
  }

  // Se borran las que ya no estan y se reescriben las demas, todo en un batch.
  // Los movimientos que apuntaban a una jarra borrada quedan con jar_id NULL
  // (ON DELETE SET NULL): se pierde la imputacion, no el movimiento.
  const ids = jarras.map((j) => j.id);
  const marcadores = ids.map((_, i) => `?${i + 2}`).join(',');

  const sentencias = [
    ids.length > 0
      ? env.DB.prepare(`DELETE FROM jar WHERE household_id = ?1 AND id NOT IN (${marcadores})`)
        .bind(sesion.householdId, ...ids)
      : env.DB.prepare('DELETE FROM jar WHERE household_id = ?1').bind(sesion.householdId),
    ...jarras.map((j) =>
      env.DB.prepare(
        `INSERT INTO jar (id, household_id, name, percentage_bp, color, icon,
                          display_order, acumula, entity_id, fill_kind, fill_minor, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, percentage_bp=excluded.percentage_bp,
           color=excluded.color, icon=excluded.icon,
           display_order=excluded.display_order, acumula=excluded.acumula,
           entity_id=excluded.entity_id, fill_kind=excluded.fill_kind,
           fill_minor=excluded.fill_minor`,
      ).bind(j.id, sesion.householdId, j.name, j.percentageBp, j.color, j.icon,
             j.displayOrder, j.acumula ? 1 : 0, j.entityId, j.fillKind, j.fillMinor,
             j.createdAt),
    ),
  ];

  await env.DB.batch(sentencias);

  const jars = await listarJarras(env, sesion.householdId);
  // Un solo evento con la lista completa. Antes se mandaba una jarra por
  // evento y el cliente los descartaba, asi que el otro telefono no veia el
  // cambio hasta recargar.
  await difundir(env, sesion.householdId, { kind: 'jars', jars, by: sesion.memberId });
  return json({ jars });
}

// --- presupuestos --------------------------------------------------------

/**
 * Guardar un presupuesto.
 *
 * Hay dos formas, y la de evento es la que vale:
 *
 *   EVENTO   «Viaje a Cancún, $2.000». Un nombre y un tope, sin mes ni
 *            categoria. Nace, se le cargan gastos a mano y se cierra.
 *   MENSUAL  el de antes, por mes y categoria. Se conserva para no romper lo
 *            que ya existe, pero no se crea mas desde la app: un tope mensual
 *            por categoria que acumula es exactamente una jarra.
 *
 * Un evento no aparta plata ni toca ninguna cuenta: solo lleva la cuenta de
 * cuanto se lleva gastado contra el tope. La plata sale de las jarras como
 * cualquier gasto.
 */
export async function guardarPresupuesto(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);

  const nombre = body.name === undefined || body.name === null || body.name === ''
    ? null
    : texto(body.name, 'name', { max: 80, min: 1 });
  const amountMinor = entero(body.amountMinor, 'amountMinor', { min: 0, max: 999_999_999_999 });
  const t = ahora();
  const id = idOpcional(body.id, 'id') ?? nuevoId();

  const icono = body.icon === undefined || body.icon === null || body.icon === ''
    ? null
    : texto(body.icon, 'icon', { max: 40, min: 1 });

  // --- Evento: nombre, icono y tope. ----------------------------------------
  if (nombre !== null) {
    const entityId = idOpcional(body.entityId, 'entityId');
    const cerrado = body.closedAt === undefined ? undefined
      : body.closedAt === null ? null
        : entero(body.closedAt, 'closedAt', { min: 0 });

    // El periodo se guarda porque la columna es NOT NULL y el indice unico lo
    // usa. En un evento es solo el mes en que nacio y no significa nada mas.
    const mes = new Date(t);
    const period = `${mes.getUTCFullYear()}-${String(mes.getUTCMonth() + 1).padStart(2, '0')}`;

    const existe = await env.DB.prepare(
      'SELECT id FROM budget WHERE id = ?1 AND household_id = ?2',
    ).bind(id, sesion.householdId).first();

    if (existe) {
      // Los `?n` se arman contando, no a mano: la version anterior intercalaba
      // `closed_at` en el medio y dejaba los numeros fijos, asi que agregar una
      // columna al final corria todos los parametros de lugar y la sentencia
      // terminaba comparando el household_id contra el icono.
      const campos = [
        ['name', nombre],
        ['amount_minor', amountMinor],
        ['entity_id', entityId],
        ['icon', icono],
        ['updated_at', t],
        ...(cerrado === undefined ? [] : [['closed_at', cerrado] as const]),
      ] as const;

      const asignaciones = campos.map(([col], i) => `${col} = ?${i + 1}`).join(', ');
      await env.DB.prepare(
        `UPDATE budget SET ${asignaciones}
          WHERE id = ?${campos.length + 1} AND household_id = ?${campos.length + 2}`,
      ).bind(...campos.map(([, v]) => v), id, sesion.householdId).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO budget (id, household_id, name, category_id, amount_minor, period,
                             closed_at, created_at, updated_at, entity_id, icon)
         VALUES (?1,?2,?3,NULL,?4,?5,?6,?7,?7,?8,?9)`,
      ).bind(
        id, sesion.householdId, nombre, amountMinor, period, cerrado ?? null, t, entityId, icono,
      ).run();
    }

    const filaEvento = await env.DB.prepare('SELECT * FROM budget WHERE id = ?1')
      .bind(id).first<Record<string, unknown>>();
    if (!filaEvento) return error('No se pudo guardar el presupuesto', 500);
    const budget = aBudget(filaEvento);
    await difundir(env, sesion.householdId, { kind: 'budget:upsert', budget, by: sesion.memberId });
    return json({ budget });
  }

  // --- Mensual por categoria ------------------------------------------------

  // Editar uno que ya existe: solo cambia el monto. El mes y la categoria son
  // su identidad —el indice unico es justamente (hogar, mes, categoria)— asi
  // que tocarlos aca lo mudaria de lugar en vez de corregirlo.
  if (body.id !== undefined && body.period === undefined) {
    const { meta } = await env.DB.prepare(
      'UPDATE budget SET amount_minor = ?1, updated_at = ?2 WHERE id = ?3 AND household_id = ?4',
    ).bind(amountMinor, t, id, sesion.householdId).run();
    if (!meta.changes) return error('El presupuesto no existe', 404);

    const filaTope = await env.DB.prepare('SELECT * FROM budget WHERE id = ?1')
      .bind(id).first<Record<string, unknown>>();
    if (!filaTope) return error('No se pudo guardar el presupuesto', 500);
    const budget = aBudget(filaTope);
    await difundir(env, sesion.householdId, { kind: 'budget:upsert', budget, by: sesion.memberId });
    return json({ budget });
  }

  const categoryId = idOpcional(body.categoryId, 'categoryId');
  const period = periodo(body.period, 'period');

  // Un tope de categoria ya sabe de quien es —la categoria lo sabe—, asi que
  // la entidad solo se guarda en el tope global: "todo el mes de PanaClaw".
  // Guardarla tambien en el de categoria la congelaria, y mover la categoria
  // a otra economia dejaria el tope atras.
  const entityId = categoryId ? null : idOpcional(body.entityId, 'entityId');

  if (categoryId) {
    const cat = await env.DB.prepare('SELECT id FROM category WHERE id = ?1 AND household_id = ?2')
      .bind(categoryId, sesion.householdId).first();
    if (!cat) return error('La categoría no existe', 404);
  }

  // El indice unico (hogar, periodo, categoria, economia) hace que volver a
  // guardar el mismo tope lo actualice en lugar de duplicarlo. Es PARCIAL —solo
  // cubre las filas con name NULL, o sea los topes mensuales— asi que el
  // `ON CONFLICT` tiene que repetir ese `WHERE` para apuntarle al mismo indice.
  await env.DB.prepare(
    `INSERT INTO budget (id, household_id, category_id, amount_minor, period,
                         created_at, updated_at, entity_id)
     VALUES (?1,?2,?3,?4,?5,?6,?6,?7)
     ON CONFLICT(household_id, period, IFNULL(category_id, ''), IFNULL(entity_id, ''))
       WHERE name IS NULL
     DO UPDATE SET
       amount_minor = excluded.amount_minor, updated_at = excluded.updated_at`,
  ).bind(id, sesion.householdId, categoryId, amountMinor, period, t, entityId).run();

  // `name IS NULL` tambien aca: sin eso, un evento nacido el mismo mes y de la
  // misma economia coincide con estas cuatro columnas y se devolveria el
  // evento en lugar del tope que se acaba de guardar.
  const fila = await env.DB.prepare(
    `SELECT * FROM budget
      WHERE household_id = ?1 AND period = ?2 AND name IS NULL
        AND IFNULL(category_id,'') = ?3 AND IFNULL(entity_id,'') = ?4`,
  ).bind(
    sesion.householdId, period, categoryId ?? '', entityId ?? '',
  ).first<Record<string, unknown>>();
  if (!fila) return error('No se pudo guardar el presupuesto', 500);

  const budget = aBudget(fila);
  await difundir(env, sesion.householdId, { kind: 'budget:upsert', budget, by: sesion.memberId });
  return json({ budget });
}

export async function borrarPresupuesto(
  _req: Request, env: Env, sesion: Sesion, id: string,
): Promise<Response> {
  const { meta } = await env.DB.prepare('DELETE FROM budget WHERE id = ?1 AND household_id = ?2')
    .bind(id, sesion.householdId).run();
  if (!meta.changes) return error('El presupuesto no existe', 404);

  await difundir(env, sesion.householdId, { kind: 'budget:delete', id, by: sesion.memberId });
  return json({ ok: true });
}

// --- perfil de la persona ------------------------------------------------

/**
 * Cada quien edita SU perfil, nunca el del otro: el id sale de la sesion, no
 * del cuerpo de la peticion. Asi no hace falta comprobar permisos.
 */
export async function editarPerfil(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);

  const fila0 = await env.DB.prepare('SELECT * FROM member WHERE id = ?1')
    .bind(sesion.memberId).first<Record<string, unknown>>();
  if (!fila0) return error('No encontrado', 404);
  const actual = aMember(fila0);

  const displayName = texto(body.displayName ?? actual.displayName, 'displayName', { max: 60, min: 1 });
  const nuevoColor = color(body.color, actual.color);

  // Un emoji puede ocupar varios caracteres (una bandera son dos, y los que
  // llevan tono de piel o genero mas todavia), asi que el limite va en bytes
  // generoso y no en longitud de cadena.
  const emoji = body.emoji === undefined
    ? actual.emoji
    : texto(body.emoji ?? '', 'emoji', { max: 24 });

  // El orden del Inicio se guarda filtrado contra las secciones que existen,
  // para que un cliente viejo o manipulado no meta nombres inventados.
  let homeLayout = actual.homeLayout;
  if (body.homeLayout !== undefined) {
    if (!Array.isArray(body.homeLayout)) return error('homeLayout debe ser una lista', 400);
    const validas = new Set<string>(SECCIONES_INICIO);
    homeLayout = [...new Set(body.homeLayout.filter((x): x is string =>
      typeof x === 'string' && validas.has(x)))] as typeof actual.homeLayout;
  }

  let movesLayout = actual.movesLayout;
  if (body.movesLayout !== undefined) {
    if (!Array.isArray(body.movesLayout)) return error('movesLayout debe ser una lista', 400);
    const validas = new Set<string>(SECCIONES_MOVIMIENTOS);
    movesLayout = [...new Set(body.movesLayout.filter((x): x is string =>
      typeof x === 'string' && validas.has(x)))] as typeof actual.movesLayout;
  }

  const theme = body.theme === undefined
    ? actual.theme
    : unoDe(body.theme, TEMAS, 'theme');

  /**
   * La foto viene ya recortada y achicada por el navegador, como data URI.
   *
   * El tope de 256 KB es una red de seguridad, no el tamaño esperado: un
   * avatar de 256px en JPEG pesa ~20 KB. Sin tope, un cliente manipulado
   * podria meter megabytes en una fila que viaja en CADA snapshot.
   *
   * Se acepta solo `data:image/...`: una URL externa convertiria el avatar en
   * un pedido a un servidor de otro, que es justo lo que no queremos.
   */
  let photo = actual.photo;
  if (body.photo !== undefined) {
    const v = body.photo === null ? '' : String(body.photo);
    if (v !== '' && !/^data:image\/(png|jpeg|webp);base64,/.test(v)) {
      return error('La foto tiene que ser una imagen del propio dispositivo', 400);
    }
    if (v.length > 256_000) return error('La foto es demasiado grande', 400);
    photo = v;
  }

  await env.DB.prepare(
    `UPDATE member SET display_name = ?1, color = ?2, emoji = ?3, home_layout = ?4,
       theme = ?5, photo = ?6, moves_layout = ?7 WHERE id = ?8`,
  ).bind(
    displayName, nuevoColor, emoji,
    homeLayout.length > 0 ? JSON.stringify(homeLayout) : '',
    theme, photo,
    movesLayout.length > 0 ? JSON.stringify(movesLayout) : '',
    sesion.memberId,
  ).run();

  const fila = await env.DB.prepare('SELECT * FROM member WHERE id = ?1')
    .bind(sesion.memberId).first<Record<string, unknown>>();
  if (!fila) return error('No se pudo actualizar', 500);

  const member = aMember(fila);
  await difundir(env, sesion.householdId, { kind: 'member:upsert', member, by: sesion.memberId });
  return json({ member });
}

// --- listados sueltos ----------------------------------------------------

export const listarCuentasRuta = async (_r: Request, env: Env, s: Sesion) =>
  json({ accounts: await listarCuentas(env, s.householdId) });

export const listarCategoriasRuta = async (_r: Request, env: Env, s: Sesion) =>
  json({ categories: await listarCategorias(env, s.householdId) });

export const listarJarrasRuta = async (_r: Request, env: Env, s: Sesion) =>
  json({ jars: await listarJarras(env, s.householdId) });

export const listarPresupuestosRuta = async (_r: Request, env: Env, s: Sesion) =>
  json({ budgets: await listarPresupuestos(env, s.householdId) });
