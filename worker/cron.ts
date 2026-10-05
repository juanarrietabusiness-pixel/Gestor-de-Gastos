/**
 * Disparador programado: crea los movimientos de los pagos habituales.
 *
 * Corre una vez por dia. Que sea idempotente no depende de acordarse de nada:
 * cada pago guarda su next_run, y crear el movimiento avanza esa fecha en la
 * misma operacion. Volver a correr el mismo dia no encuentra nada vencido.
 *
 * Si nadie abrio la app y el disparador no corrio durante meses, se crean
 * TODOS los movimientos atrasados, no solo el ultimo: dos meses sin correr son
 * dos alquileres. El tope de fechasVencidas evita que un dato corrupto genere
 * cientos de golpe.
 */

import { aRecurring, listarCuentas, listarImputaciones, listarJarras } from './db.ts';
import { ambitoDeReparto, sentenciasImputacion } from './jarras.ts';
import type { Env } from './env.ts';
import { fechasVencidas, reglaDe, siguienteFecha } from '../shared/recurrencia.ts';

export async function correrPagosHabituales(env: Env): Promise<{ creados: number; hogares: string[] }> {
  const ahora = Date.now();

  const { results } = await env.DB.prepare(
    'SELECT * FROM recurring WHERE active = 1 AND next_run <= ?1',
  ).bind(ahora).all<Record<string, unknown>>();

  if (results.length === 0) return { creados: 0, hogares: [] };

  let creados = 0;
  const hogares = new Set<string>();

  for (const fila of results) {
    const r = aRecurring(fila);
    const fechas = fechasVencidas(reglaDe(r), r.nextRun, ahora);
    if (fechas.length === 0) continue;

    // La cuenta pudo borrarse despues de crear el pago. Sin esto, el INSERT
    // fallaria por clave foranea y el barrido se cortaria para todos.
    const cuenta = await env.DB.prepare('SELECT id FROM account WHERE id = ?1')
      .bind(r.accountId).first();
    if (!cuenta) {
      await env.DB.prepare('UPDATE recurring SET active = 0, updated_at = ?1 WHERE id = ?2')
        .bind(ahora, r.id).run();
      continue;
    }

    // Alguien tiene que figurar como autor. Se usa quien se indico; si no, la
    // persona mas antigua del hogar, que es quien lo creo.
    const autor = r.paidBy ?? (await env.DB.prepare(
      'SELECT id FROM member WHERE household_id = ?1 ORDER BY created_at ASC LIMIT 1',
    ).bind(r.householdId).first<{ id: string }>())?.id;

    if (!autor) continue;

    const proxima = siguienteFecha(reglaDe(r), fechas[fechas.length - 1]);

    // Las jarras que le tocan a este pago habitual, para congelar el reparto de
    // cada movimiento que se cree. Antes esta consulta no existia y el INSERT
    // escribia distribute_to_jars = 0 a mano: un sueldo que entraba por aca no
    // podia llegar a ninguna jarra por mas que se configurara.
    //
    // Salen de la entidad del pago habitual, que a su vez sale de su categoria:
    // un cobro de PanaClaw que se repite todos los meses va a las jarras de
    // PanaClaw, no a los frascos de la casa.
    const jars = r.distributeToJars
      ? (await ambitoDeReparto(env, r.householdId))
        .jarrasPara({ entityId: r.entityId, categoryId: r.categoryId })
      : [];

    // Todo junto: los movimientos, sus imputaciones y el avance de la fecha. Si
    // algo falla, no queda ni un movimiento creado con la fecha sin avanzar
    // (que al proximo barrido lo duplicaria).
    const sentencias = [
      ...fechas.flatMap((fecha) => {
        const txId = crypto.randomUUID();
        return [
          env.DB.prepare(
            `INSERT INTO tx (id, household_id, type, amount_minor, account_id, dest_account_id,
                             dest_amount_minor, category_id, jar_id, distribute_to_jars,
                             description, notes, date, created_by, paid_by, recurring_id,
                             created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,NULL,NULL,?6,?7,?8,?9,NULL,?10,?11,?12,?13,?14,?14)`,
          ).bind(
            txId, r.householdId, r.type, r.amountMinor, r.accountId,
            r.categoryId, r.jarId, r.distributeToJars ? 1 : 0, r.name, fecha,
            autor, r.paidBy, r.id, ahora,
          ),
          ...sentenciasImputacion(env, r.householdId, txId, {
            type: r.type,
            amountMinor: r.amountMinor,
            distributeToJars: r.distributeToJars,
            jarId: r.jarId,
          }, jars, ahora),
        ];
      }),
      env.DB.prepare('UPDATE recurring SET next_run = ?1, last_run = ?2, updated_at = ?2 WHERE id = ?3')
        .bind(proxima, ahora, r.id),
    ];

    await env.DB.batch(sentencias);
    creados += fechas.length;
    hogares.add(r.householdId);
  }

  // Avisar a quien tenga la app abierta. Se manda el snapshot de saldos en vez
  // de un evento por movimiento: son pocos hogares y evita una tormenta.
  for (const householdId of hogares) {
    try {
      const imputaciones = await listarImputaciones(env, householdId);
      const [accounts, jars] = await Promise.all([
        listarCuentas(env, householdId),
        listarJarras(env, householdId, imputaciones),
      ]);
      const hub = env.HUB.get(env.HUB.idFromName(householdId));
      await hub.fetch('https://hub/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'recargar', accounts, jars, imputaciones }),
      });
    } catch (e) {
      console.error('No se pudo avisar al hogar', householdId, e);
    }
  }

  return { creados, hogares: [...hogares] };
}
