/**
 * La papelera. Una sola, sin archivo al lado.
 *
 * Antes habia dos destinos, «archivo» y «papelera», y la diferencia no se
 * sostenia: para decidir hacia cual mandar algo habia que saber de antemano si
 * su historia iba a importar, que es justo lo que uno no sabe en el momento de
 * sacarlo de en medio. Terminaban siendo dos cajones para lo mismo.
 *
 * Ahora todo va a un solo lugar y el sistema decide lo que se puede decidir
 * solo:
 *
 *   - Se restaura de un toque, cuando sea.
 *   - A los 30 DIAS se borra de verdad lo que no tenga historia.
 *   - Lo que SI tiene historia —un movimiento, un presupuesto, un pago
 *     habitual, una categoria hija— no se borra nunca, ni a los 30 dias ni a
 *     mano. Se queda en la papelera, fuera de los selectores, y la pantalla
 *     dice por que. Borrar una categoria que usan catorce movimientos dejaria
 *     catorce movimientos huerfanos, y el historial mentiria.
 *
 * Eso ultimo es lo que hacia el archivo, pero sin pedirle a nadie que lo
 * eligiera de antemano.
 */

import type { Sesion } from '../auth.ts';
import { aAccount, aCategory, aEntity } from '../db.ts';
import type { Env } from '../env.ts';
import { ahora, cuerpo, difundir, error, json, unoDe } from '../http.ts';

/**
 * Cuanto vive algo en la papelera antes de borrarse solo.
 *
 * Es el plazo de casi cualquier papelera (fotos, correo, archivos) y por eso
 * no hay que explicarlo. Solo corre para lo que no tiene historia.
 */
export const DIAS_HASTA_BORRAR = 30;

/** Las tres cosas que se pueden sacar de circulacion. */
const TIPOS = ['categoria', 'cuenta', 'economia'] as const;
type Tipo = (typeof TIPOS)[number];

const TABLA: Record<Tipo, string> = {
  categoria: 'category',
  cuenta: 'account',
  economia: 'entity',
};

/** Como se llama en singular, para los mensajes. */
const NOMBRE: Record<Tipo, string> = {
  categoria: 'La categoría',
  cuenta: 'La cuenta',
  economia: 'La economía',
};

/**
 * Que impide borrar cada cosa de verdad, y con que frase se explica.
 *
 * Es una lista de consultas, no un `try/catch` sobre el DELETE: asi se puede
 * decir exactamente QUE la sujeta en vez de «no se pudo borrar».
 *
 * Y cada consulta trae los NOMBRES, no solo el numero. La version anterior
 * decia «1 pago habitual» y ahi se acababa la pista: para encontrarlo habia
 * que abrir Ajustes, entrar a pagos habituales y revisarlos de a uno,
 * adivinando cual era. Peor con los topes mensuales, que la pantalla de
 * presupuestos dibuja con el nombre de su categoria: como la categoria esta en
 * la papelera, y lo que esta en la papelera no existe para el resto de la app,
 * el tope aparecia como «Todo el mes» y no habia forma de relacionarlo con la
 * categoria que no se dejaba borrar.
 *
 * Y las consultas que miran otra tabla con papelera propia —las
 * subcategorias, las categorias de una economia— llevan `trashed_at IS NULL`.
 * Sin eso, una categoria y su subcategoria tiradas juntas se trababan entre
 * ellas —la madre «la usa» la hija, que tambien esta tirada, y que se va a ir
 * en este mismo barrido— y no habia forma de sacar a la madre: la lista decia
 * «se queda» por algo que ya no iba a existir.
 */
interface Atadura {
  /** Donde se busca. */
  tabla: string;
  /** La columna con la que se nombra cada fila encontrada. */
  nombre: string;
  /** La condicion. `?1` es el id de lo que esta en la papelera. */
  donde: string;
  /** Con que orden se eligen los tres que se citan. */
  orden: string;
  describir: (total: number, nombres: string[]) => string;
}

/** «3 movimientos: «Super», «Nafta» y 1 mas». */
function conNombres(frase: string, total: number, nombres: string[]): string {
  const limpios = nombres.map((n) => n.trim()).filter(Boolean);
  if (limpios.length === 0) return frase;
  const restantes = total - limpios.length;
  const citados = limpios.map((n) => `«${n}»`).join(', ');
  return restantes > 0
    ? `${frase}: ${citados} y ${restantes} mas`
    : `${frase}: ${citados}`;
}

const ATADURAS: Record<Tipo, Atadura[]> = {
  categoria: [
    {
      tabla: 'tx',
      nombre: 'description',
      donde: 'category_id = ?1',
      orden: 'date DESC',
      describir: (n, nombres) => conNombres(
        `${n} movimiento${n === 1 ? ' la usa' : 's la usan'}`, n, nombres,
      ),
    },
    {
      // Los presupuestos de evento no tienen categoria (name NOT NULL,
      // category_id NULL), asi que esto solo alcanza a los topes mensuales.
      // Se los nombra por su mes, que es lo unico que los distingue.
      tabla: 'budget',
      nombre: 'period',
      donde: 'category_id = ?1',
      orden: 'period DESC',
      describir: (n, nombres) => conNombres(
        `${n} tope mensual${n === 1 ? '' : 'es'}`, n, nombres,
      ),
    },
    {
      tabla: 'recurring',
      nombre: 'name',
      donde: 'category_id = ?1',
      orden: 'name',
      describir: (n, nombres) => conNombres(
        `${n} pago${n === 1 ? ' habitual' : 's habituales'}`, n, nombres,
      ),
    },
    {
      tabla: 'category',
      nombre: 'name',
      donde: 'parent_id = ?1 AND trashed_at IS NULL',
      orden: 'name',
      describir: (n, nombres) => conNombres(
        `${n} subcategoría${n === 1 ? '' : 's'}`, n, nombres,
      ),
    },
  ],
  cuenta: [
    {
      tabla: 'tx',
      nombre: 'description',
      donde: 'account_id = ?1 OR dest_account_id = ?1',
      orden: 'date DESC',
      describir: (n, nombres) => conNombres(
        `${n} movimiento${n === 1 ? ' la usa' : 's la usan'}`, n, nombres,
      ),
    },
    {
      tabla: 'recurring',
      nombre: 'name',
      donde: 'account_id = ?1',
      orden: 'name',
      describir: (n, nombres) => conNombres(
        `${n} pago${n === 1 ? ' habitual' : 's habituales'}`, n, nombres,
      ),
    },
    {
      /*
       * Los ajustes de saldo. Estaban SOLO en el barrido nocturno y no aca, y
       * esa asimetria era una mentira en pantalla: la papelera le ponia «se
       * borra en 12 dias» a una cuenta con ajustes, y a los 12 dias el barrido
       * la miraba, veia los ajustes y la dejaba donde estaba, para siempre y
       * sin decir por que. Y por el otro lado, «Borrar ahora» SI la borraba, y
       * como account_adjustment cuelga de la cuenta con ON DELETE CASCADE, se
       * llevaba el historial de correcciones por delante. Los dos caminos
       * decidian distinto sobre la misma cuenta.
       *
       * Ahora los dos leen esta misma lista. Un ajuste es historia —dice que
       * un dia la cuenta real no coincidia y por que—, asi que la cuenta se
       * queda, y la pantalla lo explica.
       */
      tabla: 'account_adjustment',
      nombre: 'note',
      donde: 'account_id = ?1',
      orden: 'created_at DESC',
      describir: (n, nombres) => conNombres(
        `${n} ajuste${n === 1 ? '' : 's'} de saldo`, n, nombres,
      ),
    },
  ],
  economia: [
    {
      tabla: 'category',
      nombre: 'name',
      donde: 'entity_id = ?1 AND trashed_at IS NULL',
      orden: 'name',
      describir: (n, nombres) => conNombres(
        `${n} categoría${n === 1 ? '' : 's'}`, n, nombres,
      ),
    },
    {
      tabla: 'jar',
      nombre: 'name',
      donde: 'entity_id = ?1',
      orden: 'display_order',
      describir: (n, nombres) => conNombres(
        `${n} jarra${n === 1 ? '' : 's'}`, n, nombres,
      ),
    },
    {
      tabla: 'tx',
      nombre: 'description',
      donde: 'entity_id = ?1',
      orden: 'date DESC',
      describir: (n, nombres) => conNombres(
        `${n} movimiento${n === 1 ? '' : 's'}`, n, nombres,
      ),
    },
  ],
};

/**
 * Las mismas ataduras, reducidas a «¿hay alguna?».
 *
 * La usa el barrido nocturno, que no necesita contar ni nombrar: solo
 * decidir. Sale de la MISMA lista de arriba a proposito —antes eran dos
 * listas escritas a mano, y se habian ido separando— asi que agregar una
 * atadura la aplica en los dos caminos o en ninguno.
 */
export function consultasDeAtadura(tipo: Tipo): string[] {
  return ATADURAS[tipo].map((a) => `SELECT 1 FROM ${a.tabla} WHERE ${a.donde} LIMIT 1`);
}

/** El tipo de papelera al que pertenece cada tabla. */
export const TIPO_POR_TABLA: Record<string, Tipo> = {
  category: 'categoria',
  account: 'cuenta',
  entity: 'economia',
};

/** Que ata a esta fila, en palabras. Vacio = se puede borrar. */
async function ataduras(env: Env, tipo: Tipo, id: string): Promise<string[]> {
  const razones: string[] = [];
  for (const a of ATADURAS[tipo]) {
    const { results } = await env.DB.prepare(
      `SELECT ${a.nombre} AS nombre, COUNT(*) OVER () AS total
         FROM ${a.tabla} WHERE ${a.donde} ORDER BY ${a.orden} LIMIT 3`,
    ).bind(id).all<{ nombre: string | null; total: number }>();
    if (results.length === 0) continue;
    const total = results[0].total;
    if (total <= 0) continue;
    razones.push(a.describir(total, results.map((r) => r.nombre ?? '')));
  }
  return razones;
}

/** Vuelve a difundir la fila para que la otra pantalla se entere al instante. */
async function avisar(env: Env, sesion: Sesion, tipo: Tipo, id: string): Promise<void> {
  const fila = await env.DB.prepare(
    `SELECT * FROM ${TABLA[tipo]} WHERE id = ?1 AND household_id = ?2`,
  ).bind(id, sesion.householdId).first<Record<string, unknown>>();
  if (!fila) return;

  if (tipo === 'categoria') {
    await difundir(env, sesion.householdId, {
      kind: 'category:upsert', category: aCategory(fila), by: sesion.memberId,
    });
  } else if (tipo === 'cuenta') {
    await difundir(env, sesion.householdId, {
      kind: 'account:upsert', account: aAccount(fila), by: sesion.memberId,
    });
  } else {
    await difundir(env, sesion.householdId, {
      kind: 'entity:upsert', entity: aEntity(fila), by: sesion.memberId,
    });
  }
}

const leerTipo = (v: unknown): Tipo => unoDe(v, TIPOS, 'tipo');

/**
 * A la papelera.
 *
 * `archived` se apaga en la misma sentencia: con un solo cajon no puede haber
 * una fila que este archivada Y tirada a la vez.
 *
 * POST /api/papelera  { tipo, id }
 */
export async function descartar(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);
  const tipo = leerTipo(body.tipo);
  const id = String(body.id ?? '');
  if (!id) return error('Falta el id');

  const { meta } = await env.DB.prepare(
    `UPDATE ${TABLA[tipo]} SET trashed_at = ?1, trashed_by = ?2, archived = 0
      WHERE id = ?3 AND household_id = ?4`,
  ).bind(ahora(), sesion.memberId, id, sesion.householdId).run();
  if (!meta.changes) return error(`${NOMBRE[tipo]} no existe`, 404);

  await avisar(env, sesion, tipo, id);
  return json({ ok: true });
}

/**
 * Traer algo de vuelta.
 *
 * POST /api/papelera/restaurar  { tipo, id }
 */
export async function restaurar(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);
  const tipo = leerTipo(body.tipo);
  const id = String(body.id ?? '');
  if (!id) return error('Falta el id');

  const { meta } = await env.DB.prepare(
    `UPDATE ${TABLA[tipo]} SET trashed_at = NULL, trashed_by = NULL, archived = 0
      WHERE id = ?1 AND household_id = ?2`,
  ).bind(id, sesion.householdId).run();
  if (!meta.changes) return error(`${NOMBRE[tipo]} no existe`, 404);

  await avisar(env, sesion, tipo, id);
  return json({ ok: true });
}

/**
 * Borrar de verdad lo que hay en la papelera.
 *
 * POST /api/papelera/vaciar  { tipo?, id?, items?: [{ tipo, id }] }
 *
 * Sin nada, vacia todo. Con `items` borra solo esos, que es lo que manda la
 * pantalla cuando se marcan varios con las casillas. Lo que tenga historia no
 * se toca y vuelve en `retenidos` con el motivo, para poder decirlo en pantalla
 * en vez de fallar en silencio o, peor, borrar y dejar movimientos huerfanos.
 */
export async function vaciar(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);
  const soloTipo = body.tipo === undefined ? null : leerTipo(body.tipo);
  const soloId = body.id === undefined ? null : String(body.id);

  // La seleccion, cuando viene. Se normaliza a un conjunto «tipo:id» para
  // poder preguntarle por cada fila sin recorrerla entera cada vez.
  const marcados = Array.isArray(body.items)
    ? new Set((body.items as unknown[]).map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return `${leerTipo(o.tipo)}:${String(o.id ?? '')}`;
    }))
    : null;
  if (marcados && marcados.size === 0) return error('No marcaste nada');

  const borrados: { tipo: Tipo; id: string }[] = [];
  let retenidos: { tipo: Tipo; id: string; nombre: string; motivo: string }[] = [];

  /**
   * Una pasada por todo lo tirado. Devuelve cuantas cosas borro.
   *
   * Existe como funcion porque hay que repetirla: ver el bucle de abajo.
   */
  async function pasada(): Promise<number> {
    let cuantas = 0;
    retenidos = [];

    for (const tipo of TIPOS) {
      if (soloTipo && tipo !== soloTipo) continue;

      const { results } = await env.DB.prepare(
        `SELECT id, name FROM ${TABLA[tipo]}
          WHERE household_id = ?1 AND trashed_at IS NOT NULL
            AND (?2 IS NULL OR id = ?2)`,
      ).bind(sesion.householdId, soloId).all<{ id: string; name: string }>();

      for (const fila of results) {
        if (marcados && !marcados.has(`${tipo}:${fila.id}`)) continue;
        const razones = await ataduras(env, tipo, fila.id);
        if (razones.length > 0) {
          retenidos.push({
            tipo, id: fila.id, nombre: fila.name, motivo: razones.join(', '),
          });
          continue;
        }
        await env.DB.prepare(`DELETE FROM ${TABLA[tipo]} WHERE id = ?1 AND household_id = ?2`)
          .bind(fila.id, sesion.householdId).run();
        borrados.push({ tipo, id: fila.id });
        cuantas += 1;
      }
    }

    return cuantas;
  }

  /**
   * Se repite mientras algo se haya podido borrar.
   *
   * Una sola pasada dependia del orden en que la base devolviera las filas, y
   * eso es el orden de creacion. Una economia con dos categorias tiradas
   * adentro se miraba ANTES que sus categorias si se habia creado primero —que
   * es siempre, porque la categoria nace dentro de la economia—, asi que la
   * economia se retenia por unas categorias que el mismo barrido iba a borrar
   * tres lineas mas abajo. Al terminar, la papelera quedaba con una sola cosa
   * adentro y ningun motivo visible para que siguiera ahi, y solo volviendo a
   * tocar «Borrar» se iba. Lo mismo con una categoria y sus subcategorias.
   *
   * Cada vuelta borra al menos una fila o corta, asi que como mucho da tantas
   * vueltas como cosas haya en la papelera.
   */
  while (await pasada() > 0) { /* seguir mientras haya progreso */ }

  for (const { tipo, id } of borrados) {
    const kind = tipo === 'categoria' ? 'category:delete'
      : tipo === 'cuenta' ? 'account:delete' : 'entity:delete';
    await difundir(env, sesion.householdId, { kind, id, by: sesion.memberId } as never);
  }

  return json({ ok: true, borrados: borrados.length, retenidos });
}

/**
 * Que ataduras tiene cada cosa de la papelera, sin borrar nada.
 *
 * Sirve para que la pantalla pueda decir «esta se puede borrar» o «esta la
 * usan 14 movimientos» ANTES de que toquen el botón, en vez de descubrirlo
 * despues de intentarlo.
 *
 * GET /api/papelera
 */
export async function revisar(_req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const items: {
    tipo: Tipo; id: string; motivo: string | null; diasQueQuedan: number | null;
  }[] = [];

  for (const tipo of TIPOS) {
    const { results } = await env.DB.prepare(
      `SELECT id, trashed_at FROM ${TABLA[tipo]}
        WHERE household_id = ?1 AND trashed_at IS NOT NULL`,
    ).bind(sesion.householdId).all<{ id: string; trashed_at: number }>();

    for (const { id, trashed_at } of results) {
      const razones = await ataduras(env, tipo, id);
      items.push({
        tipo,
        id,
        motivo: razones.length ? razones.join(', ') : null,
        // Lo que tiene historia no se borra nunca, asi que no tiene cuenta
        // regresiva: poner «faltan 12 dias» al lado de algo que no se va a ir
        // seria mentir en la pantalla.
        diasQueQuedan: razones.length > 0
          ? null
          : Math.max(0, Math.ceil((trashed_at + DIAS_HASTA_BORRAR * 86_400_000 - ahora()) / 86_400_000)),
      });
    }
  }

  return json({ items, diasHastaBorrar: DIAS_HASTA_BORRAR });
}
