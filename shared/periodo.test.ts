import { describe, expect, it } from 'vitest';
import {
  dentroDe, describirPeriodo, moverPeriodo, periodoAnio, periodoDia,
  periodoMes, periodoRango, periodoSemana, periodoTodo,
} from './periodo.ts';

const en = (a: number, m: number, d: number, h = 12) => new Date(a, m - 1, d, h).getTime();
const f = (e: number) => {
  const d = new Date(e);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

describe('periodoDia', () => {
  it('va de 00:00 a 23:59 del mismo dia', () => {
    const p = periodoDia(en(2026, 3, 15));
    expect(f(p.desde)).toBe('2026-03-15 00:00');
    expect(f(p.hasta)).toBe('2026-03-15 23:59');
  });

  it('incluye un movimiento de las 23:50', () => {
    // Si el fin quedara en 00:00, este quedaria afuera sin que nadie lo note.
    const p = periodoDia(en(2026, 3, 15));
    expect(dentroDe(en(2026, 3, 15, 23), p)).toBe(true);
  });
});

describe('periodoSemana', () => {
  it('va de lunes a domingo', () => {
    // 2026-03-15 es domingo.
    const p = periodoSemana(en(2026, 3, 15));
    expect(new Date(p.desde).getDay()).toBe(1);
    expect(new Date(p.hasta).getDay()).toBe(0);
    expect(f(p.desde)).toBe('2026-03-09 00:00');
    expect(f(p.hasta)).toBe('2026-03-15 23:59');
  });

  it('el domingo pertenece a la semana que arranco el lunes anterior', () => {
    // El error clasico es que el domingo abra una semana nueva.
    const domingo = periodoSemana(en(2026, 3, 15));
    const lunes = periodoSemana(en(2026, 3, 9));
    expect(domingo.desde).toBe(lunes.desde);
  });

  it('cruza fin de mes sin romperse', () => {
    const p = periodoSemana(en(2026, 4, 1));
    expect(f(p.desde)).toBe('2026-03-30 00:00');
    expect(f(p.hasta)).toBe('2026-04-05 23:59');
  });
});

describe('periodoMes', () => {
  it('cubre el mes entero', () => {
    const p = periodoMes(en(2026, 3, 15));
    expect(f(p.desde)).toBe('2026-03-01 00:00');
    expect(f(p.hasta)).toBe('2026-03-31 23:59');
  });

  it('acierta el ultimo dia de febrero', () => {
    expect(f(periodoMes(en(2026, 2, 10)).hasta)).toBe('2026-02-28 23:59');
    expect(f(periodoMes(en(2028, 2, 10)).hasta)).toBe('2028-02-29 23:59');
  });
});

describe('periodoAnio', () => {
  it('va del 1 de enero al 31 de diciembre', () => {
    const p = periodoAnio(en(2026, 6, 15));
    expect(f(p.desde)).toBe('2026-01-01 00:00');
    expect(f(p.hasta)).toBe('2026-12-31 23:59');
  });
});

describe('periodoRango', () => {
  it('cubre de punta a punta', () => {
    const p = periodoRango(en(2026, 3, 10), en(2026, 3, 20));
    expect(f(p.desde)).toBe('2026-03-10 00:00');
    expect(f(p.hasta)).toBe('2026-03-20 23:59');
  });

  it('ordena las fechas si vienen al reves', () => {
    const p = periodoRango(en(2026, 3, 20), en(2026, 3, 10));
    expect(f(p.desde)).toBe('2026-03-10 00:00');
    expect(f(p.hasta)).toBe('2026-03-20 23:59');
  });

  it('un rango de un solo dia cubre ese dia entero', () => {
    const p = periodoRango(en(2026, 3, 10), en(2026, 3, 10));
    expect(dentroDe(en(2026, 3, 10, 23), p)).toBe(true);
  });
});

describe('moverPeriodo', () => {
  it('retrocede un mes', () => {
    expect(f(moverPeriodo(periodoMes(en(2026, 3, 15)), -1).desde)).toBe('2026-02-01 00:00');
  });

  it('cruza el cambio de año', () => {
    expect(f(moverPeriodo(periodoMes(en(2026, 1, 15)), -1).desde)).toBe('2025-12-01 00:00');
  });

  it('avanza una semana', () => {
    expect(f(moverPeriodo(periodoSemana(en(2026, 3, 15)), 1).desde)).toBe('2026-03-16 00:00');
  });

  it('avanza un dia', () => {
    expect(f(moverPeriodo(periodoDia(en(2026, 3, 31)), 1).desde)).toBe('2026-04-01 00:00');
  });

  it('avanza un año', () => {
    expect(f(moverPeriodo(periodoAnio(en(2026, 6, 1)), 1).desde)).toBe('2027-01-01 00:00');
  });

  it('un rango libre no se mueve: no hay un siguiente evidente', () => {
    const p = periodoRango(en(2026, 3, 10), en(2026, 3, 20));
    expect(moverPeriodo(p, 1)).toEqual(p);
  });
});

describe('dentroDe', () => {
  it('acepta los bordes exactos', () => {
    const p = periodoMes(en(2026, 3, 15));
    expect(dentroDe(p.desde, p)).toBe(true);
    expect(dentroDe(p.hasta, p)).toBe(true);
  });

  it('rechaza un instante fuera por un milisegundo', () => {
    const p = periodoMes(en(2026, 3, 15));
    expect(dentroDe(p.desde - 1, p)).toBe(false);
    expect(dentroDe(p.hasta + 1, p)).toBe(false);
  });

  it('todo acepta cualquier fecha', () => {
    expect(dentroDe(en(1999, 1, 1), periodoTodo())).toBe(true);
    expect(dentroDe(en(2099, 1, 1), periodoTodo())).toBe(true);
  });
});

describe('describirPeriodo', () => {
  it('dice Hoy y Ayer', () => {
    expect(describirPeriodo(periodoDia(Date.now()))).toBe('Hoy');
    expect(describirPeriodo(periodoDia(Date.now() - 86_400_000))).toBe('Ayer');
  });

  it('describe el año con solo el numero', () => {
    expect(describirPeriodo(periodoAnio(en(2026, 6, 1)))).toBe('2026');
  });

  it('el mes de este año va sin año, y el de otro año con año', () => {
    const esteAnio = new Date().getFullYear();
    expect(describirPeriodo(periodoMes(en(esteAnio, 9, 15)))).toBe('septiembre');
    expect(describirPeriodo(periodoMes(en(esteAnio - 3, 9, 15))))
      .toBe(`septiembre de ${esteAnio - 3}`);
  });
});
