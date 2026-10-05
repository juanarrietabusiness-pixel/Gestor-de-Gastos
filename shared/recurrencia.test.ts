import { describe, expect, it } from 'vitest';
import {
  describirRegla, diasDelMes, fechaSegura, fechasVencidas, mesesDelCiclo,
  primeraFecha, siguienteFecha, type ReglaRecurrencia,
} from './recurrencia.ts';

const f = (epoch: number) => {
  const d = new Date(epoch);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Epoch al mediodia local, igual que lo que produce el modulo. */
const en = (a: number, m: number, d: number) => new Date(a, m - 1, d, 12, 0, 0, 0).getTime();

describe('diasDelMes', () => {
  it('conoce los meses de 31, 30 y 28', () => {
    expect(diasDelMes(2026, 0)).toBe(31);
    expect(diasDelMes(2026, 3)).toBe(30);
    expect(diasDelMes(2026, 1)).toBe(28);
  });

  it('sabe que 2028 es bisiesto', () => {
    expect(diasDelMes(2028, 1)).toBe(29);
  });

  it('aplica bien la regla del siglo: 2000 bisiesto, 2100 no', () => {
    expect(diasDelMes(2000, 1)).toBe(29);
    expect(diasDelMes(2100, 1)).toBe(28);
  });
});

describe('fechaSegura', () => {
  it('respeta un dia que existe', () => {
    expect(f(fechaSegura(2026, 0, 15).getTime())).toBe('2026-01-15');
  });

  it('recorta el 31 de febrero al 28', () => {
    // Lo ingenuo seria setDate(31) sobre febrero, que desborda a marzo.
    expect(f(fechaSegura(2026, 1, 31).getTime())).toBe('2026-02-28');
  });

  it('recorta al 29 en año bisiesto', () => {
    expect(f(fechaSegura(2028, 1, 31).getTime())).toBe('2028-02-29');
  });

  it('recorta el 31 en meses de 30', () => {
    expect(f(fechaSegura(2026, 3, 31).getTime())).toBe('2026-04-30');
  });

  it('nunca se va al mes siguiente', () => {
    for (let mes = 0; mes < 12; mes++) {
      const d = fechaSegura(2026, mes, 31);
      expect(d.getMonth()).toBe(mes);
    }
  });
});

describe('primeraFecha', () => {
  const mensual = (dia: number): ReglaRecurrencia => ({ frecuencia: 'mensual', diaDelMes: dia });

  it('toma este mes si el dia todavia no paso', () => {
    expect(f(primeraFecha(mensual(20), en(2026, 3, 10)))).toBe('2026-03-20');
  });

  it('cuenta hoy como valido', () => {
    // Un pago que arranca el 10 y se crea el 10 no espera al mes siguiente.
    expect(f(primeraFecha(mensual(10), en(2026, 3, 10)))).toBe('2026-03-10');
  });

  it('pasa al mes siguiente si el dia ya paso', () => {
    expect(f(primeraFecha(mensual(5), en(2026, 3, 10)))).toBe('2026-04-05');
  });

  it('recorta al crear un pago del 31 estando en enero', () => {
    expect(f(primeraFecha(mensual(31), en(2026, 2, 1)))).toBe('2026-02-28');
  });

  it('semanal: encuentra el proximo dia de la semana', () => {
    // 2026-03-10 es martes (2). El proximo viernes (5) es el 13.
    const regla: ReglaRecurrencia = { frecuencia: 'semanal', diaDeSemana: 5 };
    expect(new Date(en(2026, 3, 10)).getDay()).toBe(2);
    expect(f(primeraFecha(regla, en(2026, 3, 10)))).toBe('2026-03-13');
  });

  it('semanal: si hoy es el dia, es hoy', () => {
    const regla: ReglaRecurrencia = { frecuencia: 'semanal', diaDeSemana: 2 };
    expect(f(primeraFecha(regla, en(2026, 3, 10)))).toBe('2026-03-10');
  });

  it('anual: toma el año que viene si la fecha ya paso', () => {
    const regla: ReglaRecurrencia = { frecuencia: 'anual', diaDelMes: 1, mesDelAnio: 1 };
    expect(f(primeraFecha(regla, en(2026, 3, 10)))).toBe('2027-01-01');
  });

  it('anual: toma este año si todavia no llego', () => {
    const regla: ReglaRecurrencia = { frecuencia: 'anual', diaDelMes: 25, mesDelAnio: 12 };
    expect(f(primeraFecha(regla, en(2026, 3, 10)))).toBe('2026-12-25');
  });
});

describe('siguienteFecha', () => {
  it('mensual avanza un mes', () => {
    const regla: ReglaRecurrencia = { frecuencia: 'mensual', diaDelMes: 15 };
    expect(f(siguienteFecha(regla, en(2026, 3, 15)))).toBe('2026-04-15');
  });

  it('el pago del 31 vuelve al 31 despues de caer en febrero', () => {
    // Este es el caso que se rompe solo si se avanza desde el dia real en vez
    // de desde el dia pedido: quedaria clavado en el 28 para siempre.
    const regla: ReglaRecurrencia = { frecuencia: 'mensual', diaDelMes: 31 };
    const febrero = siguienteFecha(regla, en(2026, 1, 31));
    expect(f(febrero)).toBe('2026-02-28');
    expect(f(siguienteFecha(regla, febrero))).toBe('2026-03-31');
  });

  it('un pago del 31 a lo largo de un año entero cae siempre en su mes', () => {
    const regla: ReglaRecurrencia = { frecuencia: 'mensual', diaDelMes: 31 };
    let fecha = en(2026, 1, 31);
    const dias: number[] = [];
    for (let i = 0; i < 12; i++) {
      fecha = siguienteFecha(regla, fecha);
      dias.push(new Date(fecha).getDate());
    }
    // Febrero 28, los meses de 30 dan 30, el resto 31. Ninguno es 1, 2 o 3,
    // que es lo que saldria si desbordara al mes siguiente.
    expect(dias).toEqual([28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 31]);
  });

  it('semanal avanza siete dias', () => {
    const regla: ReglaRecurrencia = { frecuencia: 'semanal', diaDeSemana: 2 };
    expect(f(siguienteFecha(regla, en(2026, 3, 10)))).toBe('2026-03-17');
  });

  it('semanal cruza fin de mes sin romperse', () => {
    const regla: ReglaRecurrencia = { frecuencia: 'semanal', diaDeSemana: 2 };
    expect(f(siguienteFecha(regla, en(2026, 3, 31)))).toBe('2026-04-07');
  });

  it('anual avanza un año', () => {
    const regla: ReglaRecurrencia = { frecuencia: 'anual', diaDelMes: 25, mesDelAnio: 12 };
    expect(f(siguienteFecha(regla, en(2026, 12, 25)))).toBe('2027-12-25');
  });

  it('el 29 de febrero de un bisiesto cae en 28 al año siguiente', () => {
    const regla: ReglaRecurrencia = { frecuencia: 'anual', diaDelMes: 29, mesDelAnio: 2 };
    expect(f(siguienteFecha(regla, en(2028, 2, 29)))).toBe('2029-02-28');
  });
});

describe('fechasVencidas', () => {
  const mensual: ReglaRecurrencia = { frecuencia: 'mensual', diaDelMes: 1 };

  it('no devuelve nada si todavia no vencio', () => {
    expect(fechasVencidas(mensual, en(2026, 4, 1), en(2026, 3, 15))).toEqual([]);
  });

  it('devuelve una si vencio una', () => {
    expect(fechasVencidas(mensual, en(2026, 3, 1), en(2026, 3, 15)).map(f))
      .toEqual(['2026-03-01']);
  });

  it('devuelve todas las atrasadas, no solo la ultima', () => {
    // Si nadie abrio la app en tres meses, son tres alquileres, no uno.
    expect(fechasVencidas(mensual, en(2026, 1, 1), en(2026, 3, 15)).map(f))
      .toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  it('corta en el tope para que un dato corrupto no genere cientos', () => {
    const r = fechasVencidas(mensual, en(1990, 1, 1), en(2026, 3, 15));
    expect(r.length).toBe(24);
  });

  it('respeta un tope propio', () => {
    expect(fechasVencidas(mensual, en(2026, 1, 1), en(2026, 12, 31), 3).length).toBe(3);
  });

  it('no entra en bucle si la regla no avanza', () => {
    const rota = { frecuencia: 'ninguna' as unknown as 'mensual' };
    const r = fechasVencidas(rota, en(2026, 1, 1), en(2026, 12, 31));
    expect(r.length).toBe(1);
  });
});

describe('describirRegla', () => {
  it('describe la mensual', () => {
    expect(describirRegla({ frecuencia: 'mensual', diaDelMes: 10 })).toBe('10 del mes');
  });

  it('describe la semanal', () => {
    expect(describirRegla({ frecuencia: 'semanal', diaDeSemana: 1 })).toBe('Cada lunes');
  });

  it('describe la anual', () => {
    expect(describirRegla({ frecuencia: 'anual', diaDelMes: 25, mesDelAnio: 12 }))
      .toBe('25 de diciembre');
  });
});

// ---------------------------------------------------------------------------
// Quincenal
// ---------------------------------------------------------------------------

/** El caso real: sueldo el 15 y el ultimo dia del mes. */
const sueldo: ReglaRecurrencia = { frecuencia: 'quincenal', diaDelMes: 15, diaDelMes2: 31 };

describe('quincenal / primeraFecha', () => {
  it('antes del 15 cobra el 15 de este mes', () => {
    expect(f(primeraFecha(sueldo, en(2026, 3, 3)))).toBe('2026-03-15');
  });

  it('el mismo 15 cobra hoy, no espera a fin de mes', () => {
    expect(f(primeraFecha(sueldo, en(2026, 3, 15)))).toBe('2026-03-15');
  });

  it('pasado el 15 cobra a fin de mes', () => {
    expect(f(primeraFecha(sueldo, en(2026, 3, 16)))).toBe('2026-03-31');
  });

  it('el ultimo dia cobra ese dia', () => {
    expect(f(primeraFecha(sueldo, en(2026, 3, 31)))).toBe('2026-03-31');
  });

  it('en febrero el "31" es el 28', () => {
    expect(f(primeraFecha(sueldo, en(2026, 2, 20)))).toBe('2026-02-28');
  });

  it('con los dos dias ya pasados salta al mes que viene', () => {
    // Con 15 y ultimo dia esta rama no se alcanza nunca (el ultimo dia del
    // mes siempre es hoy o despues), asi que se prueba con dos dias
    // tempranos, que es cuando de verdad puede pasar.
    const temprano: ReglaRecurrencia = { frecuencia: 'quincenal', diaDelMes: 10, diaDelMes2: 20 };
    expect(f(primeraFecha(temprano, en(2026, 4, 25)))).toBe('2026-05-10');
  });

  it('acepta cualquier par de dias, no solo 15 y 31', () => {
    const r: ReglaRecurrencia = { frecuencia: 'quincenal', diaDelMes: 5, diaDelMes2: 20 };
    expect(f(primeraFecha(r, en(2026, 6, 10)))).toBe('2026-06-20');
    expect(f(primeraFecha(r, en(2026, 6, 21)))).toBe('2026-07-05');
  });

  it('da igual el orden en que se carguen los dos dias', () => {
    const alReves: ReglaRecurrencia = { frecuencia: 'quincenal', diaDelMes: 31, diaDelMes2: 15 };
    expect(primeraFecha(alReves, en(2026, 3, 3))).toBe(primeraFecha(sueldo, en(2026, 3, 3)));
  });

  it('sin dias explicitos usa 15 y ultimo dia', () => {
    expect(f(primeraFecha({ frecuencia: 'quincenal' }, en(2026, 3, 3)))).toBe('2026-03-15');
  });
});

describe('quincenal / siguienteFecha', () => {
  it('del 15 va a fin de mes', () => {
    expect(f(siguienteFecha(sueldo, en(2026, 1, 15)))).toBe('2026-01-31');
  });

  it('de fin de mes va al 15 del siguiente', () => {
    expect(f(siguienteFecha(sueldo, en(2026, 1, 31)))).toBe('2026-02-15');
  });

  it('desde el 28 de febrero no se queda pegado al 28', () => {
    // Es LA trampa de la quincenal: en febrero el "31" cae 28, y si se
    // avanzara desde el dia que cayo, el cobro de fin de mes pasaria a ser el
    // 28 para siempre. Tiene que volver al 15 de marzo y despues al 31.
    expect(f(siguienteFecha(sueldo, en(2026, 2, 28)))).toBe('2026-03-15');
    expect(f(siguienteFecha(sueldo, en(2026, 3, 15)))).toBe('2026-03-31');
  });

  it('cruza el año', () => {
    expect(f(siguienteFecha(sueldo, en(2026, 12, 31)))).toBe('2027-01-15');
  });

  it('un año entero da 24 cobros, siempre creciendo', () => {
    let fecha = primeraFecha(sueldo, en(2026, 1, 1));
    const fechas: string[] = [];
    for (let i = 0; i < 24; i++) {
      fechas.push(f(fecha));
      const proxima = siguienteFecha(sueldo, fecha);
      expect(proxima).toBeGreaterThan(fecha);
      fecha = proxima;
    }
    expect(fechas[0]).toBe('2026-01-15');
    expect(fechas[1]).toBe('2026-01-31');
    expect(fechas[2]).toBe('2026-02-15');
    expect(fechas[3]).toBe('2026-02-28');
    expect(fechas[23]).toBe('2026-12-31');
    // 24 fechas distintas: ninguna repetida, ninguna salteada.
    expect(new Set(fechas).size).toBe(24);
  });

  it('en un mes de 30 dias el segundo cobro es el 30', () => {
    expect(f(siguienteFecha(sueldo, en(2026, 4, 15)))).toBe('2026-04-30');
  });

  it('con dos dias que se recortan al mismo, cobra una sola vez ese mes', () => {
    // 30 y 31 en febrero son los dos el 28. Cobrar dos veces el mismo dia
    // seria duplicar plata: se salta al mes siguiente.
    const pegados: ReglaRecurrencia = { frecuencia: 'quincenal', diaDelMes: 30, diaDelMes2: 31 };
    expect(f(siguienteFecha(pegados, en(2026, 2, 28)))).toBe('2026-03-30');
  });
});

describe('quincenal / fechasVencidas', () => {
  it('dos meses sin correr dan cuatro sueldos', () => {
    const r = fechasVencidas(sueldo, en(2026, 1, 15), en(2026, 2, 28));
    expect(r.map(f)).toEqual(['2026-01-15', '2026-01-31', '2026-02-15', '2026-02-28']);
  });

  it('no adelanta la que todavia no vencio', () => {
    const r = fechasVencidas(sueldo, en(2026, 1, 15), en(2026, 1, 20));
    expect(r.map(f)).toEqual(['2026-01-15']);
  });
});

describe('quincenal / describirRegla', () => {
  it('llama al 31 "el ultimo dia"', () => {
    expect(describirRegla(sueldo)).toBe('15 y último día del mes');
  });

  it('con dos dias normales los nombra a los dos', () => {
    expect(describirRegla({ frecuencia: 'quincenal', diaDelMes: 1, diaDelMes2: 16 }))
      .toBe('1 y 16 del mes');
  });
});

// ---------------------------------------------------------------------------
// Trimestral y semestral
//
// Las dos son la misma regla que la mensual con otro paso, y el ancla
// (mesDelAnio) es lo unico que las distingue entre si: "cada 3 meses" no dice
// nada hasta que se sabe desde cual.
// ---------------------------------------------------------------------------

const trimestral: ReglaRecurrencia = {
  frecuencia: 'trimestral', diaDelMes: 15, mesDelAnio: 1,
};
const semestral: ReglaRecurrencia = {
  frecuencia: 'semestral', diaDelMes: 10, mesDelAnio: 3,
};

describe('mesesDelCiclo', () => {
  it('la trimestral cae cuatro veces, desde su ancla', () => {
    expect(mesesDelCiclo(trimestral)).toEqual([0, 3, 6, 9]);
    expect(mesesDelCiclo({ frecuencia: 'trimestral', mesDelAnio: 2 })).toEqual([1, 4, 7, 10]);
  });

  it('la semestral, dos', () => {
    expect(mesesDelCiclo(semestral)).toEqual([2, 8]);
  });

  it('el ancla de diciembre no se va del año', () => {
    expect(mesesDelCiclo({ frecuencia: 'trimestral', mesDelAnio: 12 })).toEqual([2, 5, 8, 11]);
  });

  it('la mensual y la semanal no tienen ciclo de meses', () => {
    expect(mesesDelCiclo({ frecuencia: 'mensual' })).toEqual([]);
    expect(mesesDelCiclo({ frecuencia: 'semanal' })).toEqual([]);
  });
});

describe('trimestral / primeraFecha', () => {
  it('si hoy es el dia, es hoy', () => {
    expect(f(primeraFecha(trimestral, en(2026, 4, 15)))).toBe('2026-04-15');
  });

  it('dentro de un mes del ciclo pero pasado el dia, salta al ciclo siguiente', () => {
    // No al mes que viene: mayo no es del ciclo.
    expect(f(primeraFecha(trimestral, en(2026, 4, 20)))).toBe('2026-07-15');
  });

  it('en un mes que no es del ciclo, va al proximo que si lo es', () => {
    expect(f(primeraFecha(trimestral, en(2026, 5, 3)))).toBe('2026-07-15');
  });

  it('desde noviembre cruza al enero siguiente', () => {
    expect(f(primeraFecha(trimestral, en(2026, 11, 20)))).toBe('2027-01-15');
  });

  it('respeta el ancla: con febrero de ancla, cae en febrero y no en enero', () => {
    const r: ReglaRecurrencia = { frecuencia: 'trimestral', diaDelMes: 5, mesDelAnio: 2 };
    expect(f(primeraFecha(r, en(2026, 1, 10)))).toBe('2026-02-05');
  });

  it('recorta el dia al ultimo real del mes', () => {
    const r: ReglaRecurrencia = { frecuencia: 'trimestral', diaDelMes: 31, mesDelAnio: 2 };
    expect(f(primeraFecha(r, en(2026, 2, 1)))).toBe('2026-02-28');
  });
});

describe('semestral / primeraFecha', () => {
  it('cae en su ancla', () => {
    expect(f(primeraFecha(semestral, en(2026, 1, 1)))).toBe('2026-03-10');
  });

  it('pasada la primera, va a la segunda del año', () => {
    expect(f(primeraFecha(semestral, en(2026, 4, 1)))).toBe('2026-09-10');
  });

  it('pasadas las dos, cruza de año', () => {
    expect(f(primeraFecha(semestral, en(2026, 10, 1)))).toBe('2027-03-10');
  });
});

describe('trimestral y semestral / siguienteFecha', () => {
  it('la trimestral suma tres meses', () => {
    expect(f(siguienteFecha(trimestral, en(2026, 1, 15)))).toBe('2026-04-15');
    expect(f(siguienteFecha(trimestral, en(2026, 10, 15)))).toBe('2027-01-15');
  });

  it('la semestral suma seis', () => {
    expect(f(siguienteFecha(semestral, en(2026, 3, 10)))).toBe('2026-09-10');
    expect(f(siguienteFecha(semestral, en(2026, 9, 10)))).toBe('2027-03-10');
  });

  it('el dia recortado no se queda pegado: vuelve al de la regla', () => {
    // Un cobro "el 31" que en febrero cayo el 28 tiene que volver al 31.
    const r: ReglaRecurrencia = { frecuencia: 'trimestral', diaDelMes: 31, mesDelAnio: 2 };
    expect(f(siguienteFecha(r, en(2026, 2, 28)))).toBe('2026-05-31');
  });
});

describe('trimestral / fechasVencidas', () => {
  it('recupera las que se saltearon, de a una', () => {
    const r = fechasVencidas(trimestral, en(2026, 1, 15), en(2026, 8, 1));
    expect(r.map(f)).toEqual(['2026-01-15', '2026-04-15', '2026-07-15']);
  });
});

describe('trimestral y semestral / describirRegla', () => {
  it('nombra los cuatro meses en vez de decir "cada 3 meses"', () => {
    expect(describirRegla(trimestral)).toBe('15 de enero, abril, julio y octubre');
  });

  it('nombra los dos de la semestral', () => {
    expect(describirRegla(semestral)).toBe('10 de marzo y septiembre');
  });
});

describe('la mensual y la anual no cambiaron', () => {
  it('la mensual sigue cayendo todos los meses', () => {
    const r: ReglaRecurrencia = { frecuencia: 'mensual', diaDelMes: 10 };
    expect(f(primeraFecha(r, en(2026, 5, 3)))).toBe('2026-05-10');
    expect(f(primeraFecha(r, en(2026, 5, 20)))).toBe('2026-06-10');
    expect(f(siguienteFecha(r, en(2026, 5, 10)))).toBe('2026-06-10');
  });

  it('la mensual del 31 se recorta en febrero y despues vuelve al 31', () => {
    const r: ReglaRecurrencia = { frecuencia: 'mensual', diaDelMes: 31 };
    expect(f(siguienteFecha(r, en(2026, 1, 31)))).toBe('2026-02-28');
    expect(f(siguienteFecha(r, en(2026, 2, 28)))).toBe('2026-03-31');
  });

  it('la anual sigue cayendo una vez al año, en su mes', () => {
    const r: ReglaRecurrencia = { frecuencia: 'anual', diaDelMes: 20, mesDelAnio: 6 };
    expect(f(primeraFecha(r, en(2026, 1, 1)))).toBe('2026-06-20');
    expect(f(primeraFecha(r, en(2026, 7, 1)))).toBe('2027-06-20');
    expect(f(siguienteFecha(r, en(2026, 6, 20)))).toBe('2027-06-20');
  });
});
