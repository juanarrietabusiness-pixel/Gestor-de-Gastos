/**
 * El barrido de la papelera: borra lo vencido, una vez por dia.
 *
 * Corre junto a los pagos habituales. Solo toca lo que lleva mas de
 * DIAS_HASTA_BORRAR en la papelera Y no tiene nada colgando: si una categoria
 * la usan catorce movimientos, se queda ahi para siempre. La invariante
 * «vaciar nunca deja un movimiento huerfano» vale igual cuando el que vacia es
 * el reloj y no una persona.
 *
 * Idempotente: al dia siguiente ya no encuentra esas filas.
 */

import type { Env } from './env.ts';
import { consultasDeAtadura, DIAS_HASTA_BORRAR, TIPO_POR_TABLA } from './routes/papelera.ts';

/**
 * Tabla -> las consultas que dicen «esto no se puede borrar».
 *
 * Salen de la MISMA declaracion que usa la papelera para explicar en pantalla
 * por que algo se queda (ver `ATADURAS` en routes/papelera.ts). Antes eran dos
 * listas escritas a mano, una aca y otra alla, y se habian separado: los
 * ajustes de saldo frenaban al barrido pero la pantalla no los contaba, asi que
 * una cuenta con ajustes decia «se borra en 12 dias» y a los 12 dias seguia
 * ahi, sin explicacion. Con una sola declaracion eso no puede volver a pasar.
 */
const ATADO: Record<string, string[]> = Object.fromEntries(
  Object.entries(TIPO_POR_TABLA).map(([tabla, tipo]) => [tabla, consultasDeAtadura(tipo)]),
);

export async function barrerPapelera(env: Env): Promise<{ borrados: number }> {
  const corte = Date.now() - DIAS_HASTA_BORRAR * 86_400_000;
  let borrados = 0;

  for (const [tabla, consultas] of Object.entries(ATADO)) {
    const { results } = await env.DB.prepare(
      `SELECT id FROM ${tabla} WHERE trashed_at IS NOT NULL AND trashed_at <= ?1`,
    ).bind(corte).all<{ id: string }>();

    for (const { id } of results) {
      let atado = false;
      for (const sql of consultas) {
        if (await env.DB.prepare(sql).bind(id).first()) { atado = true; break; }
      }
      if (atado) continue;

      await env.DB.prepare(`DELETE FROM ${tabla} WHERE id = ?1`).bind(id).run();
      borrados += 1;
    }
  }

  return { borrados };
}
