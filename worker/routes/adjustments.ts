/**
 * Ajuste manual del saldo de una cuenta.
 *
 * El saldo que se ve es derivado: saldo inicial + efecto de los movimientos.
 * Ajustarlo mueve el saldo INICIAL por la diferencia; los movimientos quedan
 * exactamente como estaban y los que vengan despues lo siguen modificando.
 *
 * La cuenta se hace con SQL, contra el saldo que la base tiene en ese
 * instante, y no con el numero que el navegador traia en pantalla. Si mientras
 * alguien abre la hoja de ajuste la otra persona carga un gasto, el saldo que
 * el navegador conocia ya es viejo: confiar en el dejaria la cuenta en un
 * valor que nadie pidio. Con esta forma, el saldo final es el pedido aunque
 * haya entrado un movimiento un segundo antes.
 */

import type { Sesion } from '../auth.ts';
import { aAdjustment, cuentaPorId, sumaDeMovimientos } from '../db.ts';
import type { Env } from '../env.ts';
import {
  ahora, cuerpo, difundir, entero, error, json, nuevoId, textoOpcional,
} from '../http.ts';

const MAX_SALDO = 999_999_999_999;

/** Historial de ajustes de una cuenta. Se pide al abrir su detalle. */
export async function listar(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const accountId = new URL(req.url).searchParams.get('account');
  if (!accountId) return error('Falta la cuenta', 400);

  const { results } = await env.DB.prepare(
    `SELECT * FROM account_adjustment
      WHERE household_id = ?1 AND account_id = ?2
      ORDER BY created_at DESC LIMIT 50`,
  ).bind(sesion.householdId, accountId).all<Record<string, unknown>>();

  return json({ adjustments: results.map(aAdjustment) });
}

export async function crear(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);

  const accountId = String(body.accountId ?? '');
  const antes = await cuentaPorId(env, sesion.householdId, accountId);
  if (!antes) return error('La cuenta no existe', 404);

  const objetivo = entero(body.balanceMinor, 'balanceMinor', {
    min: -MAX_SALDO, max: MAX_SALDO,
  });
  const note = textoOpcional(body.note, 'note', 200);

  // Sin cambio no se guarda nada: un historial lleno de ajustes de cero
  // esconderia los que si importan.
  if (objetivo === antes.balanceMinor) return json({ account: antes, adjustment: null });

  const t = ahora();
  const id = nuevoId();

  // Despejar el saldo inicial: si saldo = inicial + movimientos y se quiere
  // que saldo valga X, entonces inicial = X - movimientos.
  //
  // La resta va adentro del UPDATE, con la misma expresion que calcula el
  // saldo al leerlo. Asi se evalua en el mismo instante en que se escribe, y
  // no queda ventana para que un movimiento que entre en el medio deje la
  // cuenta en un numero que nadie pidio.
  await env.DB.prepare(
    `UPDATE account
        SET initial_balance_minor = ?1 - (${sumaDeMovimientos('account.id')}),
            updated_at = ?2
      WHERE id = ?3 AND household_id = ?4`,
  ).bind(objetivo, t, accountId, sesion.householdId).run();

  const account = await cuentaPorId(env, sesion.householdId, accountId);
  if (!account) return error('No se pudo ajustar el saldo', 500);

  await env.DB.prepare(
    `INSERT INTO account_adjustment (id, household_id, account_id, member_id,
                                     from_minor, to_minor, delta_minor, note, created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
  ).bind(
    id, sesion.householdId, accountId, sesion.memberId,
    antes.balanceMinor, account.balanceMinor, account.balanceMinor - antes.balanceMinor,
    note, t,
  ).run();

  // La otra persona ve el saldo nuevo sin recargar.
  await difundir(env, sesion.householdId, {
    kind: 'account:upsert', account, by: sesion.memberId,
  });

  const adjustment = await env.DB.prepare('SELECT * FROM account_adjustment WHERE id = ?1')
    .bind(id).first<Record<string, unknown>>();

  return json({ account, adjustment: adjustment ? aAdjustment(adjustment) : null }, { status: 201 });
}
