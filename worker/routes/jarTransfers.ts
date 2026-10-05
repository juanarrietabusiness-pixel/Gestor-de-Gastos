/**
 * Traspasos entre jarras.
 *
 * Mover plata de Ahorro a Diversion no toca ninguna cuenta: no es un
 * movimiento de dinero, es un cambio de plan. Es lo unico que permite arreglar
 * una jarra que quedo en negativo; sin esto el rojo se queda para siempre.
 */

import type { Sesion } from '../auth.ts';
import {
  aJarTransfer, listarAportes, listarCuentas, listarImputaciones, listarJarras,
  listarTraspasos,
} from '../db.ts';
import { ambitoDeReparto, sentenciasImputacion } from '../jarras.ts';
import { repartirEnJarras, validarJarras } from '../../shared/domain.ts';
import { TxType } from '../../shared/types.ts';
import type { Env } from '../env.ts';
import {
  ahora, cuerpo, difundir, entero, error, json, nuevoId, texto, textoOpcional,
} from '../http.ts';

const MAX_MONTO = 999_999_999_999;

export const listar = async (_r: Request, env: Env, s: Sesion) =>
  json({ jarTransfers: await listarTraspasos(env, s.householdId) });

export async function crear(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);

  const fromJarId = texto(body.fromJarId, 'fromJarId', { max: 64, min: 1 });
  const toJarId = texto(body.toJarId, 'toJarId', { max: 64, min: 1 });
  if (fromJarId === toJarId) return error('Elige dos jarras distintas', 400);

  const amountMinor = entero(body.amountMinor, 'amountMinor', { min: 1, max: MAX_MONTO });
  const note = textoOpcional(body.note, 'note', 200);
  const date = entero(body.date ?? ahora(), 'date', { min: 0, max: 4_102_444_800_000 });

  // Las dos tienen que ser del hogar. Una sola consulta: si faltara alguna, no
  // hay forma de que el conteo de dos.
  const { results } = await env.DB.prepare(
    'SELECT id FROM jar WHERE household_id = ?1 AND id IN (?2, ?3)',
  ).bind(sesion.householdId, fromJarId, toJarId).all<{ id: string }>();
  if (results.length !== 2) return error('Alguna de las jarras no existe', 404);

  const id = nuevoId();
  const t = ahora();

  await env.DB.prepare(
    `INSERT INTO jar_transfer (id, household_id, from_jar_id, to_jar_id, amount_minor,
                               note, date, created_by, created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
  ).bind(id, sesion.householdId, fromJarId, toJarId, amountMinor, note, date, sesion.memberId, t).run();

  const fila = await env.DB.prepare('SELECT * FROM jar_transfer WHERE id = ?1')
    .bind(id).first<Record<string, unknown>>();
  if (!fila) return error('No se pudo guardar el traspaso', 500);
  const transfer = aJarTransfer(fila);

  await difundir(env, sesion.householdId, {
    kind: 'jarTransfer:upsert', transfer, by: sesion.memberId,
  });
  return json({ transfer, jars: await listarJarras(env, sesion.householdId) }, { status: 201 });
}

/**
 * Un negocio le paga a la casa (o a otro negocio).
 *
 * Es el escalon que faltaba del modelo que usan: esta el negocio, el negocio
 * le paga a Abrinay o a Avalon, y esa plata recien ahi se reparte en los seis
 * frascos de la casa.
 *
 * No toca ninguna cuenta, y no puede: las cuentas estan mezcladas, no hay una
 * que sea de PanaClaw. La plata ya esta ahi adentro; lo que cambia es de quien
 * es. Por eso NO es un ingreso ni un gasto —contarlo como tal duplicaria el
 * total del hogar, porque el negocio ya lo conto cuando cobro—, y por eso
 * tampoco puede ser una transferencia entre cuentas.
 *
 * Sale de una jarra del negocio y entra repartido en las de la casa, con las
 * reglas de la casa. Son varios traspasos con la misma nota, escritos en un
 * solo batch: borrarlos deshace el pago entero, igual que borrar un
 * movimiento devuelve su saldo.
 */
export async function pagar(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);

  const fromJarId = texto(body.fromJarId, 'fromJarId', { max: 64, min: 1 });
  const toEntityId = texto(body.toEntityId, 'toEntityId', { max: 64, min: 1 });
  const amountMinor = entero(body.amountMinor, 'amountMinor', { min: 1, max: MAX_MONTO });
  const note = textoOpcional(body.note, 'note', 200);
  const date = entero(body.date ?? ahora(), 'date', { min: 0, max: 4_102_444_800_000 });

  const todas = await listarJarras(env, sesion.householdId);
  const origen = todas.find((j) => j.id === fromJarId);
  if (!origen) return error('La jarra de origen no existe', 404);

  const destino = todas.filter((j) => j.entityId === toEntityId);
  if (destino.length === 0) {
    return error('Esa economía todavía no tiene jarras donde poner la plata', 400);
  }
  if (origen.entityId === toEntityId) {
    return error('Para mover dentro de la misma economía usá un traspaso', 400);
  }

  // Los porcentajes del destino tienen que cerrar: si no, el pago entraria a
  // medias y la diferencia quedaria flotando entre las jarras y el sin asignar.
  const { ok, sumaBp, motivo } = validarJarras(destino);
  if (!ok) {
    return error(
      motivo ?? `Antes de cobrar, los porcentajes de esa economía tienen que sumar 100%. Ahora suman ${(sumaBp / 100).toFixed(2)}%.`,
      400,
    );
  }

  const partes = repartirEnJarras(amountMinor, destino);
  const t = ahora();
  const filas = [...partes].filter(([, monto]) => monto > 0).map(([toJarId, monto]) => ({
    id: nuevoId(), toJarId, monto,
  }));
  if (filas.length === 0) return error('El monto es muy chico para repartirlo', 400);

  await env.DB.batch(filas.map((f) => env.DB.prepare(
    `INSERT INTO jar_transfer (id, household_id, from_jar_id, to_jar_id, amount_minor,
                               note, date, created_by, created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
  ).bind(f.id, sesion.householdId, fromJarId, f.toJarId, f.monto, note, date, sesion.memberId, t)));

  // Se recarga entero: son varios traspasos de una vez y mandar uno por uno
  // seria una tormenta de eventos por algo que el otro telefono lee como una
  // sola cosa.
  const [accounts, jars, jarTransfers] = await Promise.all([
    listarCuentas(env, sesion.householdId),
    listarJarras(env, sesion.householdId),
    listarTraspasos(env, sesion.householdId),
  ]);
  await difundir(env, sesion.householdId, { kind: 'recargar', accounts, jars });

  return json({ transfers: jarTransfers.filter(
    (x) => filas.some((f) => f.id === x.id),
  ), jars }, { status: 201 });
}

export async function borrar(
  _req: Request, env: Env, sesion: Sesion, id: string,
): Promise<Response> {
  const { meta } = await env.DB.prepare(
    'DELETE FROM jar_transfer WHERE id = ?1 AND household_id = ?2',
  ).bind(id, sesion.householdId).run();
  if (!meta.changes) return error('El traspaso no existe', 404);

  await difundir(env, sesion.householdId, { kind: 'jarTransfer:delete', id, by: sesion.memberId });
  return json({ ok: true, jars: await listarJarras(env, sesion.householdId) });
}

/**
 * Poner al dia los ingresos que nunca llegaron a las jarras.
 *
 * Hasta la migracion 0004, repartir era un interruptor apagado por defecto al
 * final del formulario. En los primeros 44 movimientos nadie lo encendio
 * nunca, asi que las jarras solo recibieron gastos y varias quedaron en
 * negativo: plata saliendo de sobres que jamas se llenaron.
 *
 * Esto reparte esos ingresos huerfanos con los porcentajes de HOY, que es lo
 * unico que se puede hacer: no hay forma de saber que porcentajes habrian
 * elegido en su momento, y de todos modos nunca los aplicaron.
 *
 * Salta los que ya apuntan a una jarra: esos ya tomaron una decision y
 * repartirlos ahora la borraria.
 *
 * Cada ingreso cae en las jarras de SU entidad. Un cobro viejo de PanaClaw no
 * va a los frascos de la casa por el hecho de ser viejo.
 */
export async function ponerAlDia(_r: Request, env: Env, sesion: Sesion): Promise<Response> {
  const jars = await listarJarras(env, sesion.householdId);
  if (jars.length === 0) return error('No hay jarras configuradas', 400);

  const ambito = await ambitoDeReparto(env, sesion.householdId);

  // Ingresos sin jarra, sin reparto y sin ninguna imputacion escrita.
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.amount_minor, t.category_id, t.entity_id
       FROM tx t
      WHERE t.household_id = ?1
        AND t.type = ?2
        AND t.jar_id IS NULL
        AND t.distribute_to_jars = 0
        AND NOT EXISTS (SELECT 1 FROM jar_imputacion i WHERE i.tx_id = t.id)`,
  ).bind(sesion.householdId, TxType.INGRESO).all<{
    id: string; amount_minor: number; category_id: string | null; entity_id: string | null;
  }>();

  if (results.length === 0) {
    return json({ repartidos: 0, jars });
  }

  const t = ahora();
  const sentencias: D1PreparedStatement[] = [];
  let repartidos = 0;

  for (const fila of results) {
    const suyas = ambito.jarrasPara({
      entityId: fila.entity_id, categoryId: fila.category_id,
    });
    // Sin jarras propias no hay donde ponerlo. Repartirlo en las de otra
    // entidad seria peor que dejarlo sin asignar, que al menos se ve.
    if (suyas.length === 0) continue;

    // Los porcentajes tienen que cerrar DENTRO de la entidad. Si los de un
    // negocio no cierran, se frena todo y se dice cual: repartir a medias
    // dejaria plata perdida entre el sin asignar y las jarras.
    const { ok, sumaBp } = validarJarras(suyas);
    if (!ok) {
      return error(
        `Antes de repartir, los porcentajes tienen que sumar 100%. Ahora suman ${(sumaBp / 100).toFixed(2)}%.`,
        400,
      );
    }

    sentencias.push(
      env.DB.prepare('UPDATE tx SET distribute_to_jars = 1, updated_at = ?1 WHERE id = ?2')
        .bind(t, fila.id),
      ...sentenciasImputacion(env, sesion.householdId, fila.id, {
        type: TxType.INGRESO,
        amountMinor: Number(fila.amount_minor),
        distributeToJars: true,
        jarId: null,
      }, suyas, t),
    );
    repartidos += 1;
  }

  if (repartidos === 0) return json({ repartidos: 0, jars });

  await env.DB.batch(sentencias);

  // Se recarga entero: cambiaron varios movimientos de una vez y parchear uno
  // por uno seria una tormenta de eventos por algo que pasa una sola vez.
  const [accounts, jarsNuevas, imputaciones] = await Promise.all([
    listarCuentas(env, sesion.householdId),
    listarJarras(env, sesion.householdId),
    listarImputaciones(env, sesion.householdId),
  ]);
  await difundir(env, sesion.householdId, {
    kind: 'recargar', accounts, jars: jarsNuevas, imputaciones,
  });

  return json({ repartidos, jars: jarsNuevas });
}

// ---------------------------------------------------------------------------
// Asignar a las jarras lo que estaba sin asignar
// ---------------------------------------------------------------------------

/**
 * Reparte entre las jarras plata que YA esta en las cuentas y que ninguna
 * jarra vio nunca.
 *
 * El caso que lo motiva: la pantalla decia "Sin asignar $887.10" con todos los
 * movimientos asignados. Era cierto —$887.10 es exactamente la suma de los
 * saldos iniciales de las cuentas— pero no habia forma de bajarlo ni de
 * entenderlo. Las jarras solo ven movimientos, y ese capital de arranque nunca
 * fue uno.
 *
 * No toca ninguna cuenta: la plata ya estaba ahi, lo que cambia es para que
 * esta. Y se deshace borrando los aportes, porque el saldo de la jarra no se
 * guarda, se suma.
 */
export async function asignar(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);

  const amountMinor = entero(body.amountMinor, 'amountMinor', { min: 1, max: MAX_MONTO });
  const note = textoOpcional(body.note, 'note', 200);
  const date = entero(body.date ?? ahora(), 'date', { min: 0, max: 4_102_444_800_000 });
  const jarId = body.jarId === undefined || body.jarId === null
    ? null
    : texto(body.jarId, 'jarId', { max: 64, min: 1 });

  const todas = await listarJarras(env, sesion.householdId);
  if (todas.length === 0) return error('No hay jarras configuradas', 400);

  // A una sola jarra, o repartido entre las de una economia.
  let partes: Map<string, number>;
  if (jarId) {
    const jarra = todas.find((j) => j.id === jarId);
    if (!jarra) return error('La jarra no existe', 404);
    partes = new Map([[jarId, amountMinor]]);
  } else {
    const entityId = body.entityId === undefined || body.entityId === null
      ? null
      : texto(body.entityId, 'entityId', { max: 64, min: 1 });
    const destino = entityId === null ? todas : todas.filter((j) => j.entityId === entityId);
    if (destino.length === 0) return error('Esa economía no tiene jarras', 400);

    const { ok, sumaBp, motivo } = validarJarras(destino);
    if (!ok) {
      return error(
        motivo ?? `Para repartir, los porcentajes tienen que sumar 100%. Ahora suman ${(sumaBp / 100).toFixed(2)}%.`,
        400,
      );
    }
    partes = repartirEnJarras(amountMinor, destino);
  }

  const t = ahora();
  const filas = [...partes]
    .filter(([, monto]) => monto !== 0)
    .map(([jid, monto]) => ({ id: nuevoId(), jarId: jid, monto }));
  if (filas.length === 0) return error('El monto es muy chico para repartirlo', 400);

  await env.DB.batch(filas.map((f) => env.DB.prepare(
    `INSERT INTO jar_aporte (id, household_id, jar_id, amount_minor, note, date,
                             created_by, created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
  ).bind(f.id, sesion.householdId, f.jarId, f.monto, note, date, sesion.memberId, t)));

  const [accounts, jars, jarAportes] = await Promise.all([
    listarCuentas(env, sesion.householdId),
    listarJarras(env, sesion.householdId),
    listarAportes(env, sesion.householdId),
  ]);
  await difundir(env, sesion.householdId, { kind: 'recargar', accounts, jars });

  return json({
    aportes: jarAportes.filter((a) => filas.some((f) => f.id === a.id)),
    jars,
  }, { status: 201 });
}

/** Devolver un aporte al sin asignar. */
export async function borrarAporte(
  _req: Request, env: Env, sesion: Sesion, id: string,
): Promise<Response> {
  const { meta } = await env.DB.prepare(
    'DELETE FROM jar_aporte WHERE id = ?1 AND household_id = ?2',
  ).bind(id, sesion.householdId).run();
  if (!meta.changes) return error('El aporte no existe', 404);

  await difundir(env, sesion.householdId, { kind: 'jarAporte:delete', id, by: sesion.memberId });
  return json({ ok: true, jars: await listarJarras(env, sesion.householdId) });
}
