/**
 * El barrido de la papelera, que es lo unico que borra sin que nadie lo pida.
 *
 * Corre de noche y no hay quien lo mire: si se equivoca, se lleva cosas que
 * nadie queria perder. Por eso se prueba contra una D1 de mentira en vez de
 * levantar un Worker: asi se puede poner una fila «tirada hace 40 dias» sin
 * tocar reloj ni base de verdad.
 */

import { describe, expect, it } from 'vitest';
import { barrerPapelera } from './papelera-vieja.ts';
import type { Env } from './env.ts';
import { consultasDeAtadura, TIPO_POR_TABLA } from './routes/papelera.ts';

interface Fila { id: string; tabla: string; trashedAt: number | null; atada: boolean }

/**
 * Una D1 con lo justo: entiende las tres formas de consulta que usa el
 * barrido —listar lo vencido, preguntar si algo esta atado, y borrar—.
 */
function baseFalsa(filas: Fila[]) {
  const vivas = [...filas];

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const arg = args[0];
          return {
            async all<T>() {
              const tabla = /FROM (\w+)/.exec(sql)?.[1] ?? '';
              const corte = Number(arg);
              return {
                results: vivas
                  .filter((f) => f.tabla === tabla && f.trashedAt !== null && f.trashedAt <= corte)
                  .map((f) => ({ id: f.id })) as T[],
              };
            },
            async first() {
              // Cualquier «SELECT 1 FROM ... WHERE algo = ?1» es una atadura.
              const f = vivas.find((x) => x.id === String(arg));
              return f?.atada ? { 1: 1 } : null;
            },
            async run() {
              const i = vivas.findIndex((x) => x.id === String(arg));
              if (i >= 0) vivas.splice(i, 1);
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };

  return { env: { DB: db } as unknown as Env, vivas };
}

const dias = (n: number) => Date.now() - n * 86_400_000;

describe('barrerPapelera', () => {
  it('borra lo vencido que no tiene nada colgando', async () => {
    const { env, vivas } = baseFalsa([
      { id: 'vieja', tabla: 'category', trashedAt: dias(40), atada: false },
    ]);
    const { borrados } = await barrerPapelera(env);
    expect(borrados).toBe(1);
    expect(vivas).toHaveLength(0);
  });

  it('NO borra lo que todavía no cumplió los 30 días', async () => {
    const { env, vivas } = baseFalsa([
      { id: 'fresca', tabla: 'category', trashedAt: dias(29), atada: false },
    ]);
    const { borrados } = await barrerPapelera(env);
    expect(borrados).toBe(0);
    expect(vivas.map((f) => f.id)).toEqual(['fresca']);
  });

  it('NO borra lo que tiene historia, por más viejo que sea', async () => {
    const { env, vivas } = baseFalsa([
      { id: 'usada', tabla: 'category', trashedAt: dias(400), atada: true },
    ]);
    const { borrados } = await barrerPapelera(env);
    expect(borrados).toBe(0);
    expect(vivas.map((f) => f.id)).toEqual(['usada']);
  });

  it('NO toca lo que no está en la papelera', async () => {
    const { env, vivas } = baseFalsa([
      { id: 'en-uso', tabla: 'category', trashedAt: null, atada: false },
    ]);
    await barrerPapelera(env);
    expect(vivas.map((f) => f.id)).toEqual(['en-uso']);
  });

  it('separa bien dentro de una misma tanda', async () => {
    const { env, vivas } = baseFalsa([
      { id: 'cat-vieja', tabla: 'category', trashedAt: dias(45), atada: false },
      { id: 'cat-usada', tabla: 'category', trashedAt: dias(45), atada: true },
      { id: 'cuenta-vieja', tabla: 'account', trashedAt: dias(60), atada: false },
      { id: 'cuenta-usada', tabla: 'account', trashedAt: dias(60), atada: true },
      { id: 'eco-nueva', tabla: 'entity', trashedAt: dias(1), atada: false },
    ]);
    const { borrados } = await barrerPapelera(env);
    expect(borrados).toBe(2);
    expect(vivas.map((f) => f.id).sort()).toEqual(['cat-usada', 'cuenta-usada', 'eco-nueva']);
  });
});

/**
 * La papelera de pantalla y el barrido nocturno tienen que decidir IGUAL.
 *
 * Eran dos listas de ataduras escritas a mano, una en cada archivo, y se
 * habian separado sin que nada avisara: los ajustes de saldo frenaban al
 * barrido pero no los contaba la pantalla, asi que una cuenta con ajustes
 * mostraba «se borra en 12 dias» y a los 12 dias seguia exactamente donde
 * estaba. Ahora las dos salen de la misma declaracion; esto es lo que impide
 * que vuelvan a separarse.
 */
describe('las ataduras son una sola lista', () => {
  it('cubre los tres tipos de la papelera', () => {
    for (const tipo of ['categoria', 'cuenta', 'economia'] as const) {
      expect(consultasDeAtadura(tipo).length).toBeGreaterThan(0);
    }
  });

  it('cada tabla de la papelera tiene su tipo', () => {
    expect(TIPO_POR_TABLA).toEqual({
      category: 'categoria',
      account: 'cuenta',
      entity: 'economia',
    });
  });

  it('una cuenta con ajustes de saldo está atada, no solo para el barrido', () => {
    const sqls = consultasDeAtadura('cuenta');
    expect(sqls.some((s) => s.includes('account_adjustment'))).toBe(true);
  });

  it('las subcategorías ya tiradas NO atan a su madre', () => {
    // Sin esto, madre e hija tiradas juntas se trababan entre ellas y ninguna
    // de las dos se podia borrar nunca.
    const sqls = consultasDeAtadura('categoria');
    const hijas = sqls.find((s) => s.includes('parent_id'));
    expect(hijas).toContain('trashed_at IS NULL');
  });

  it('las categorías ya tiradas NO atan a su economía', () => {
    const sqls = consultasDeAtadura('economia');
    const suyas = sqls.find((s) => s.includes('FROM category'));
    expect(suyas).toContain('trashed_at IS NULL');
  });
});
