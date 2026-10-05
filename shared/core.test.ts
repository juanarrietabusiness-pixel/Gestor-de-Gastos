import { describe, expect, it } from 'vitest';
import { formatMonto, parseMonto, repartir } from './money.ts';
import {
  autorDe, balancePorMes, calcularJarras, calcularPatrimonio, calcularSaldos,
  efectoEnCuenta, entidadDe, entidadPorDefecto, flujoDeJarras, imputacionJarras,
  indexarCategorias, jarrasDe, porPersona, repartirEnJarras, resultadoPorEntidad,
  resumir, sinAsignar, validarJarras,
} from './domain.ts';
import { periodoMes } from './periodo.ts';
import { leer } from './parser.ts';
import {
  AccountCategory, type Account, type Category, type Entity, type Jar,
  type JarImputacion, type JarTransfer, type Member, type Transaction, TxType,
} from './types.ts';

// --- helpers -------------------------------------------------------------

const tx = (p: Partial<Transaction>): Transaction => ({
  id: crypto.randomUUID(), householdId: 'h', type: TxType.GASTO, amountMinor: 0,
  accountId: 'a1', destAccountId: null, destAmountMinor: null, categoryId: null,
  jarId: null, distributeToJars: false, description: '', notes: null,
  date: Date.now(), createdBy: 'u1', paidBy: null, recurringId: null, budgetId: null,
  entityId: null, createdAt: 0, updatedAt: 0, ...p,
});

const cuenta = (p: Partial<Account>): Account => ({
  id: 'a1', householdId: 'h', name: 'Cuenta', category: AccountCategory.EFECTIVO,
  currency: 'USD', initialBalanceMinor: 0, balanceMinor: 0, color: '#000',
  icon: 'wallet', owner: 'compartida', archived: false, trashedAt: null,
  trashedBy: null, displayOrder: 0, createdAt: 0, updatedAt: 0, entityId: null, ...p,
});

const jarra = (id: string, bp: number, orden: number, acumula = false, extra: Partial<Jar> = {}): Jar => ({
  id, householdId: 'h', name: id, percentageBp: bp, color: '#000', icon: 'jar',
  displayOrder: orden, createdAt: 0, balanceMinor: 0, acumula,
  entityId: null, fillKind: 'porcentaje', fillMinor: null, ...extra,
});

/**
 * Congela las imputaciones de una tanda de movimientos, que es exactamente lo
 * que hace el Worker al guardarlos. Los tests trabajan sobre el resultado
 * congelado, no sobre el recalculo, igual que la app.
 */
const imputar = (movs: Transaction[], jars: Jar[]): JarImputacion[] =>
  movs.flatMap((m) =>
    [...imputacionJarras(m, jars)].map(([jarId, amountMinor]) => ({
      id: `${m.id}:${jarId}`, householdId: 'h', txId: m.id, jarId, amountMinor, createdAt: 0,
    })));

const fechasDe = (movs: Transaction[]) => {
  const mapa = new Map(movs.map((m) => [m.id, m.date]));
  return (txId: string) => mapa.get(txId);
};

const categoria = (p: Partial<Category>): Category => ({
  id: 'c1', householdId: 'h', name: 'Categoría', type: 'gasto', parentId: null,
  icon: 'tag', color: '#000', archived: false, trashedAt: null, trashedBy: null,
  displayOrder: 0, createdAt: 0, entityId: null, ...p,
});

const traspaso = (p: Partial<JarTransfer>): JarTransfer => ({
  id: crypto.randomUUID(), householdId: 'h', fromJarId: 'j1', toJarId: 'j2',
  amountMinor: 0, note: null, date: Date.now(), createdBy: 'u1', createdAt: 0, ...p,
});

// --- dinero --------------------------------------------------------------

describe('parseMonto', () => {
  it('lee formato con punto decimal', () => {
    expect(parseMonto('1234.56')).toBe(123456);
  });

  it('lee formato con coma decimal', () => {
    expect(parseMonto('1234,56')).toBe(123456);
  });

  it('lee miles con punto y decimales con coma', () => {
    expect(parseMonto('1.234,56')).toBe(123456);
  });

  it('lee miles con coma y decimales con punto', () => {
    expect(parseMonto('1,234.56')).toBe(123456);
  });

  it('trata un grupo suelto de tres digitos como miles', () => {
    expect(parseMonto('1.234')).toBe(123400);
  });

  it('ignora simbolos de moneda y espacios', () => {
    expect(parseMonto('$ 1 234,50')).toBe(123450);
  });

  it('respeta monedas sin decimales', () => {
    expect(parseMonto('1500', 'CLP')).toBe(1500);
  });

  it('devuelve null si no hay numero', () => {
    expect(parseMonto('hola')).toBeNull();
  });

  it('no pierde precision donde los floats fallan', () => {
    // 0.1 + 0.2 !== 0.3 en float. En centavos es 10 + 20 === 30, exacto.
    expect(parseMonto('0.1')! + parseMonto('0.2')!).toBe(parseMonto('0.3'));
  });
});

describe('formatMonto', () => {
  it('formatea en USD', () => {
    expect(formatMonto(123456)).toBe('$1,234.56');
  });

  it('muestra negativos con el signo adelante', () => {
    expect(formatMonto(-123456)).toBe('-$1,234.56');
  });

  it('agrega signo explicito cuando se pide', () => {
    expect(formatMonto(500, 'USD', { signo: true })).toBe('+$5.00');
  });
});

describe('repartir', () => {
  it('reparte exacto sin perder centavos', () => {
    // El caso que rompia la version anterior: jarras de 2,5% sobre $1.000.
    const bps = [5500, 1000, 1000, 1000, 1000, 250, 250]; // suma 10000
    const partes = repartir(100_000, bps);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(100_000);
  });

  it('cuadra incluso con un total indivisible', () => {
    const partes = repartir(100, [3333, 3333, 3334]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('cuadra para cualquier total, probado exhaustivamente', () => {
    const bps = [5500, 1000, 1000, 1000, 1000, 250, 250];
    for (let total = 0; total < 3000; total++) {
      const suma = repartir(total, bps).reduce((a, b) => a + b, 0);
      expect(suma).toBe(total);
    }
  });

  it('es determinista', () => {
    const bps = [3333, 3333, 3334];
    expect(repartir(1000, bps)).toEqual(repartir(1000, bps));
  });

  it('da los centavos sobrantes al resto mas grande', () => {
    // 10 centavos entre 1/3 y 2/3: 3.33 y 6.66 -> pisos 3 y 6, sobra 1.
    expect(repartir(10, [3333, 6667])).toEqual([3, 7]);
  });

  it('maneja montos negativos', () => {
    expect(repartir(-100, [5000, 5000])).toEqual([-50, -50]);
  });

  it('devuelve ceros si los pesos suman cero', () => {
    expect(repartir(100, [0, 0])).toEqual([0, 0]);
  });
});

// --- saldos --------------------------------------------------------------

describe('efectoEnCuenta', () => {
  it('un ingreso suma en su cuenta', () => {
    expect(efectoEnCuenta(tx({ type: TxType.INGRESO, amountMinor: 5000 }), 'a1')).toBe(5000);
  });

  it('un gasto resta en su cuenta', () => {
    expect(efectoEnCuenta(tx({ type: TxType.GASTO, amountMinor: 5000 }), 'a1')).toBe(-5000);
  });

  it('no toca cuentas ajenas', () => {
    expect(efectoEnCuenta(tx({ type: TxType.GASTO, amountMinor: 5000 }), 'otra')).toBe(0);
  });

  it('una transferencia resta en origen y suma en destino', () => {
    const t = tx({ type: TxType.TRANSFERENCIA, amountMinor: 5000, accountId: 'a1', destAccountId: 'a2' });
    expect(efectoEnCuenta(t, 'a1')).toBe(-5000);
    expect(efectoEnCuenta(t, 'a2')).toBe(5000);
  });

  it('una transferencia entre monedas usa el monto de destino', () => {
    const t = tx({
      type: TxType.TRANSFERENCIA, amountMinor: 5000,
      accountId: 'a1', destAccountId: 'a2', destAmountMinor: 480000,
    });
    expect(efectoEnCuenta(t, 'a1')).toBe(-5000);
    expect(efectoEnCuenta(t, 'a2')).toBe(480000);
  });

  it('una transferencia a la misma cuenta se anula', () => {
    const t = tx({ type: TxType.TRANSFERENCIA, amountMinor: 5000, accountId: 'a1', destAccountId: 'a1' });
    expect(efectoEnCuenta(t, 'a1')).toBe(0);
  });
});

describe('calcularSaldos', () => {
  it('parte del saldo inicial y aplica los movimientos', () => {
    const cuentas = [cuenta({ id: 'a1', initialBalanceMinor: 100_000 })];
    const movs = [
      tx({ type: TxType.GASTO, amountMinor: 25_000 }),
      tx({ type: TxType.INGRESO, amountMinor: 5_000 }),
    ];
    expect(calcularSaldos(cuentas, movs).get('a1')).toBe(80_000);
  });

  it('no se desincroniza al recalcular (no hay estado acumulado)', () => {
    const cuentas = [cuenta({ id: 'a1', initialBalanceMinor: 0 })];
    const movs = Array.from({ length: 500 }, () => tx({ type: TxType.GASTO, amountMinor: 333 }));
    expect(calcularSaldos(cuentas, movs).get('a1')).toBe(-166_500);
    expect(calcularSaldos(cuentas, movs).get('a1')).toBe(-166_500);
  });
});

describe('calcularPatrimonio', () => {
  it('suma los saldos con su signo', () => {
    // Convencion: el signo vive en el saldo. Una tarjeta con consumo queda en
    // negativo, asi que sumarla ya la resta del patrimonio.
    const cuentas = [
      cuenta({ id: 'a1', category: AccountCategory.EFECTIVO, balanceMinor: 100_000 }),
      cuenta({ id: 'a2', category: AccountCategory.TARJETA_CREDITO, balanceMinor: -30_000 }),
    ];
    expect(calcularPatrimonio(cuentas)).toBe(70_000);
  });

  it('ignora las cuentas archivadas', () => {
    const cuentas = [
      cuenta({ id: 'a1', balanceMinor: 100_000 }),
      cuenta({ id: 'a2', balanceMinor: 50_000, archived: true }),
    ];
    expect(calcularPatrimonio(cuentas)).toBe(100_000);
  });
});

// --- jarras --------------------------------------------------------------

describe('calcularJarras', () => {
  const jarras = [
    jarra('j1', 5500, 0), jarra('j2', 1000, 1), jarra('j3', 1000, 2),
    jarra('j4', 1000, 3), jarra('j5', 1000, 4), jarra('j6', 250, 5), jarra('j7', 250, 6),
  ];
  const saldos = (movs: Transaction[], transfers: JarTransfer[] = []) =>
    calcularJarras(jarras, imputar(movs, jarras), transfers, []);

  it('reparte un ingreso sin perder ni un centavo', () => {
    const movs = [tx({ type: TxType.INGRESO, amountMinor: 333_333, distributeToJars: true })];
    const suma = [...saldos(movs).values()].reduce((a, b) => a + b, 0);
    expect(suma).toBe(333_333);
  });

  it('imputa un gasto a su jarra', () => {
    const movs = [tx({ type: TxType.GASTO, amountMinor: 10_000, jarId: 'j1' })];
    expect(saldos(movs).get('j1')).toBe(-10_000);
  });

  it('no imputa nada si el gasto no tiene jarra', () => {
    const movs = [tx({ type: TxType.GASTO, amountMinor: 10_000 })];
    expect([...saldos(movs).values()].every((v) => v === 0)).toBe(true);
  });

  it('el total de las jarras sigue al total de ingresos tras muchos meses', () => {
    const movs = Array.from({ length: 24 }, () =>
      tx({ type: TxType.INGRESO, amountMinor: 123_457, distributeToJars: true }));
    const suma = [...saldos(movs).values()].reduce((a, b) => a + b, 0);
    expect(suma).toBe(24 * 123_457);
  });

  it('CAMBIAR UN PORCENTAJE NO REESCRIBE EL PASADO', () => {
    // El bug que arreglan las imputaciones congeladas. Antes, subir el ahorro
    // del 10% al 20% volvia a partir el sueldo de enero con la receta nueva y
    // el saldo se movia sin que nadie cargara nada.
    const enero = [tx({ type: TxType.INGRESO, amountMinor: 100_000, distributeToJars: true })];
    const congeladas = imputar(enero, jarras);
    const antes = calcularJarras(jarras, congeladas, [], []).get('j2');

    const nuevoReparto = [
      jarra('j1', 4500, 0), jarra('j2', 2000, 1), jarra('j3', 1000, 2),
      jarra('j4', 1000, 3), jarra('j5', 1000, 4), jarra('j6', 250, 5), jarra('j7', 250, 6),
    ];
    const despues = calcularJarras(nuevoReparto, congeladas, [], []).get('j2');

    expect(antes).toBe(10_000);
    expect(despues).toBe(antes);
  });

  it('un traspaso mueve plata de una jarra a la otra sin crear ni destruir', () => {
    const movs = [tx({ type: TxType.INGRESO, amountMinor: 100_000, distributeToJars: true })];
    const antes = saldos(movs);
    const t = [traspaso({ fromJarId: 'j1', toJarId: 'j4', amountMinor: 3_000 })];
    const despues = saldos(movs, t);

    expect(despues.get('j1')).toBe(antes.get('j1')! - 3_000);
    expect(despues.get('j4')).toBe(antes.get('j4')! + 3_000);
    const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    expect(total(despues)).toBe(total(antes));
  });

  it('una imputacion a una jarra que ya no existe no rompe ni se cuela', () => {
    const huerfana: JarImputacion = {
      id: 'x', householdId: 'h', txId: 't', jarId: 'borrada', amountMinor: 5_000, createdAt: 0,
    };
    const r = calcularJarras(jarras, [huerfana], [], []);
    expect(r.has('borrada')).toBe(false);
    expect([...r.values()].every((v) => v === 0)).toBe(true);
  });

  describe('leer por periodo', () => {
    const enero = new Date(2026, 0, 15, 12).getTime();
    const febrero = new Date(2026, 1, 15, 12).getTime();
    const movs = [
      tx({ id: 'e', type: TxType.INGRESO, amountMinor: 100_000, distributeToJars: true, date: enero }),
      tx({ id: 'f', type: TxType.INGRESO, amountMinor: 200_000, distributeToJars: true, date: febrero }),
      tx({ id: 'g', type: TxType.GASTO, amountMinor: 5_000, jarId: 'j1', date: febrero }),
    ];
    const imp = imputar(movs, jarras);
    const fechas = fechasDe(movs);

    it('el saldo de toda la vida suma los dos meses', () => {
      const r = calcularJarras(jarras, imp, [], [], fechas);
      expect([...r.values()].reduce((a, b) => a + b, 0)).toBe(300_000 - 5_000);
    });

    it('el mes solo cuenta lo suyo', () => {
      const r = calcularJarras(jarras, imp, [], [], fechas, periodoMes(febrero));
      expect([...r.values()].reduce((a, b) => a + b, 0)).toBe(200_000 - 5_000);
    });

    it('lo que sobra del mes anterior NO se tira: sigue en el acumulado', () => {
      // Leer por mes es una forma de mirar, no un borron.
      const mes = calcularJarras(jarras, imp, [], [], fechas, periodoMes(febrero)).get('j1')!;
      const vida = calcularJarras(jarras, imp, [], [], fechas).get('j1')!;
      expect(vida).toBeGreaterThan(mes);
    });

    it('separa lo que entro de lo que salio', () => {
      const f = flujoDeJarras(jarras, imp, [], [], fechas, periodoMes(febrero)).get('j1')!;
      expect(f.entroMinor).toBe(110_000);
      expect(f.salioMinor).toBe(5_000);
    });
  });
});

describe('sinAsignar', () => {
  const jarras = [jarra('j1', 5000, 0), jarra('j2', 5000, 1)];

  it('es la plata que existe menos la que ya tiene trabajo', () => {
    const cuentas = [cuenta({ id: 'a1', balanceMinor: 100_000 })];
    const movs = [tx({ type: TxType.INGRESO, amountMinor: 40_000, distributeToJars: true })];
    const s = calcularJarras(jarras, imputar(movs, jarras), [], []);
    expect(sinAsignar(cuentas, s)).toBe(60_000);
  });

  it('jarras mas sin asignar da SIEMPRE la plata real, pase lo que pase', () => {
    // La invariante que hace que los dos libros dejen de ser paralelos.
    const cuentas = [cuenta({ id: 'a1', balanceMinor: 74_555 })];
    const casos: Transaction[][] = [
      [],
      [tx({ type: TxType.INGRESO, amountMinor: 30_000, distributeToJars: true })],
      [tx({ type: TxType.INGRESO, amountMinor: 30_000, jarId: 'j1' })],
      [tx({ type: TxType.GASTO, amountMinor: 7_000, jarId: 'j2' })],
      [tx({ type: TxType.GASTO, amountMinor: 7_000 })],
      [tx({ type: TxType.TRANSFERENCIA, amountMinor: 5_000 })],
      [tx({ type: TxType.AJUSTE, amountMinor: 1_234 })],
      [
        tx({ type: TxType.INGRESO, amountMinor: 33_333, distributeToJars: true }),
        tx({ type: TxType.GASTO, amountMinor: 1_111, jarId: 'j1' }),
        tx({ type: TxType.GASTO, amountMinor: 999 }),
      ],
    ];
    for (const movs of casos) {
      const s = calcularJarras(jarras, imputar(movs, jarras), [], []);
      const enJarras = [...s.values()].reduce((a, b) => a + b, 0);
      expect(enJarras + sinAsignar(cuentas, s)).toBe(74_555);
    }
  });

  it('un traspaso no lo mueve: la plata no salio de las jarras', () => {
    const cuentas = [cuenta({ id: 'a1', balanceMinor: 100_000 })];
    const movs = [tx({ type: TxType.INGRESO, amountMinor: 40_000, distributeToJars: true })];
    const imp = imputar(movs, jarras);
    const antes = sinAsignar(cuentas, calcularJarras(jarras, imp, [], []));
    const t = [traspaso({ fromJarId: 'j1', toJarId: 'j2', amountMinor: 8_000 })];
    expect(sinAsignar(cuentas, calcularJarras(jarras, imp, t, []))).toBe(antes);
  });

  it('las cuentas archivadas no respaldan jarras', () => {
    const cuentas = [
      cuenta({ id: 'a1', balanceMinor: 100_000 }),
      cuenta({ id: 'a2', balanceMinor: 50_000, archived: true }),
    ];
    expect(sinAsignar(cuentas, new Map())).toBe(100_000);
  });

  it('avisa cuando asignaron mas de lo que tienen', () => {
    const cuentas = [cuenta({ id: 'a1', balanceMinor: 10_000 })];
    const movs = [tx({ type: TxType.INGRESO, amountMinor: 40_000, distributeToJars: true })];
    expect(sinAsignar(cuentas, calcularJarras(jarras, imputar(movs, jarras), [], []))).toBeLessThan(0);
  });
});

describe('validarJarras', () => {
  it('acepta un reparto que suma 100%', () => {
    expect(validarJarras([jarra('j1', 5000, 0), jarra('j2', 5000, 1)]).ok).toBe(true);
  });

  it('rechaza un reparto incompleto', () => {
    expect(validarJarras([jarra('j1', 5000, 0)]).ok).toBe(false);
  });
});

// --- resumenes -----------------------------------------------------------

describe('resumir', () => {
  it('separa ingresos de gastos', () => {
    const r = resumir([
      tx({ type: TxType.INGRESO, amountMinor: 100_000 }),
      tx({ type: TxType.GASTO, amountMinor: 30_000 }),
    ]);
    expect(r).toMatchObject({ ingresoMinor: 100_000, gastoMinor: 30_000, flujoMinor: 70_000 });
  });

  it('excluye transferencias para no inflar los totales', () => {
    const r = resumir([
      tx({ type: TxType.GASTO, amountMinor: 30_000 }),
      tx({ type: TxType.TRANSFERENCIA, amountMinor: 500_000, destAccountId: 'a2' }),
    ]);
    expect(r.gastoMinor).toBe(30_000);
    expect(r.ingresoMinor).toBe(0);
  });
});

describe('autorDe', () => {
  it('usa quien lo cargo si no se dijo quien gasto', () => {
    expect(autorDe(tx({ createdBy: 'u1', paidBy: null }))).toBe('u1');
  });

  it('quien gasto le gana a quien lo cargo', () => {
    // Uno anota la compra que hizo el otro: cuenta para el que gasto.
    expect(autorDe(tx({ createdBy: 'u1', paidBy: 'u2' }))).toBe('u2');
  });
});

describe('porPersona', () => {
  const ana: Member = { id: 'u1', householdId: 'h', email: 'a@a', displayName: 'Ana', color: '#f00', emoji: '', homeLayout: [], movesLayout: [], theme: 'auto', photo: '', createdAt: 0 };
  const beto: Member = { id: 'u2', householdId: 'h', email: 'b@b', displayName: 'Beto', color: '#00f', emoji: '', homeLayout: [], movesLayout: [], theme: 'auto', photo: '', createdAt: 0 };

  it('atribuye a quien gasto, no a quien cargo', () => {
    const movs = [
      // Ana carga un gasto que hizo Beto.
      tx({ type: TxType.GASTO, amountMinor: 10_000, createdBy: 'u1', paidBy: 'u2' }),
      tx({ type: TxType.GASTO, amountMinor: 4_000, createdBy: 'u1', paidBy: null }),
    ];
    const r = porPersona(movs, [ana, beto]);
    const deAna = r.find((x) => x.member.id === 'u1')!;
    const deBeto = r.find((x) => x.member.id === 'u2')!;
    expect(deBeto.resumen.gastoMinor).toBe(10_000);
    expect(deAna.resumen.gastoMinor).toBe(4_000);
  });
});

describe('balancePorMes', () => {
  it('acumula el flujo mes a mes', () => {
    const enero = new Date(2026, 0, 15, 12).getTime();
    const febrero = new Date(2026, 1, 15, 12).getTime();
    const movs = [
      tx({ type: TxType.INGRESO, amountMinor: 100_000, date: enero }),
      tx({ type: TxType.GASTO, amountMinor: 30_000, date: enero }),
      tx({ type: TxType.GASTO, amountMinor: 50_000, date: febrero }),
    ];
    const r = balancePorMes(movs, ['2026-01', '2026-02']);
    expect(r[0].resumen.flujoMinor).toBe(70_000);
    expect(r[0].acumuladoMinor).toBe(70_000);
    expect(r[1].resumen.flujoMinor).toBe(-50_000);
    expect(r[1].acumuladoMinor).toBe(20_000);
  });
});

// --- parser --------------------------------------------------------------

describe('leer', () => {
  const categorias: Category[] = [
    { id: 'c1', householdId: 'h', name: 'Comida', type: 'gasto', parentId: null, icon: 'x', color: '#000', archived: false, trashedAt: null, trashedBy: null, displayOrder: 0, createdAt: 0, entityId: null },
    { id: 'c2', householdId: 'h', name: 'Sueldo', type: 'ingreso', parentId: null, icon: 'x', color: '#000', archived: false, trashedAt: null, trashedBy: null, displayOrder: 0, createdAt: 0, entityId: null },
  ];
  const vacio = { categories: categorias, historial: [] as Transaction[] };

  it('separa monto y descripcion', () => {
    const r = leer('cafe 3500', vacio);
    expect(r.amountMinor).toBe(350_000);
    expect(r.description).toBe('Cafe');
  });

  it('funciona con el monto adelante', () => {
    expect(leer('3500 cafe', vacio).amountMinor).toBe(350_000);
  });

  it('deduce la categoria por palabra clave', () => {
    const r = leer('super 12000', vacio);
    expect(r.categoryId).toBe('c1');
    expect(r.razon).toBe('palabra-clave');
  });

  it('detecta ingresos', () => {
    const r = leer('sueldo 500000', vacio);
    expect(r.type).toBe(TxType.INGRESO);
    expect(r.categoryId).toBe('c2');
  });

  it('asume gasto cuando no hay senales', () => {
    expect(leer('algo raro 100', vacio).type).toBe(TxType.GASTO);
  });

  it('el historial propio le gana a las palabras clave', () => {
    const historial = [
      tx({ description: 'Cafe de la esquina', categoryId: 'c9', type: TxType.GASTO }),
      tx({ description: 'Cafe de la esquina', categoryId: 'c9', type: TxType.GASTO }),
    ];
    const r = leer('cafe 3500', { categories: categorias, historial });
    expect(r.categoryId).toBe('c9');
    expect(r.razon).toBe('historial');
  });

  it('no explota con entrada vacia', () => {
    const r = leer('', vacio);
    expect(r.amountMinor).toBeNull();
    expect(r.description).toBeTruthy();
  });

  it('lee montos con decimales', () => {
    expect(leer('nafta 15.750,80', vacio).amountMinor).toBe(1_575_080);
  });
});

// --- patrimonio con deuda (regresion) ------------------------------------

describe('calcularPatrimonio con tarjeta de credito', () => {
  it('la deuda resta, no suma', () => {
    // Bug real que aparecio probando contra la base: la tarjeta quedaba en
    // -450 (el gasto resta del saldo) y el patrimonio le daba vuelta el signo
    // otra vez, asi que la deuda sumaba $450 en vez de restarlos.
    const cuentas = [
      cuenta({ id: 'a1', category: AccountCategory.EFECTIVO, balanceMinor: 100_000 }),
      cuenta({ id: 'a2', category: AccountCategory.TARJETA_CREDITO, balanceMinor: -45_000 }),
    ];
    expect(calcularPatrimonio(cuentas)).toBe(55_000);
  });

  it('el saldo de la tarjeta baja al gastar con ella', () => {
    const cuentas = [cuenta({ id: 'tc', category: AccountCategory.TARJETA_CREDITO, initialBalanceMinor: 0 })];
    const movs = [tx({ type: TxType.GASTO, amountMinor: 45_000, accountId: 'tc' })];
    expect(calcularSaldos(cuentas, movs).get('tc')).toBe(-45_000);
  });

  it('pagar la tarjeta desde el banco la lleva de vuelta a cero', () => {
    const cuentas = [
      cuenta({ id: 'banco', category: AccountCategory.CUENTA_CORRIENTE, initialBalanceMinor: 100_000 }),
      cuenta({ id: 'tc', category: AccountCategory.TARJETA_CREDITO, initialBalanceMinor: 0 }),
    ];
    const movs = [
      tx({ type: TxType.GASTO, amountMinor: 45_000, accountId: 'tc' }),
      tx({ type: TxType.TRANSFERENCIA, amountMinor: 45_000, accountId: 'banco', destAccountId: 'tc' }),
    ];
    const saldos = calcularSaldos(cuentas, movs);
    expect(saldos.get('tc')).toBe(0);
    expect(saldos.get('banco')).toBe(55_000);

    const conSaldos = cuentas.map((c) => ({ ...c, balanceMinor: saldos.get(c.id)! }));
    expect(calcularPatrimonio(conSaldos)).toBe(55_000);
  });
});

// --- entidades -----------------------------------------------------------

describe('entidadDe', () => {
  const cats = [
    categoria({ id: 'video', name: 'Video musical', type: 'gasto', entityId: 'buko' }),
    categoria({ id: 'panaclaw', name: 'PanaClaw', type: 'ingreso', entityId: 'pc' }),
    categoria({ id: 'comida', name: 'Alimentos', type: 'gasto', entityId: 'familia' }),
    categoria({ id: 'suelta', name: 'Sin dueño', type: 'gasto', entityId: null }),
  ];
  const indice = indexarCategorias(cats);

  it('la hereda de la categoria', () => {
    expect(entidadDe(tx({ categoryId: 'video' }), indice)).toBe('buko');
  });

  it('el movimiento manda si la tiene puesta a mano', () => {
    expect(entidadDe(tx({ categoryId: 'video', entityId: 'familia' }), indice)).toBe('familia');
  });

  it('sin categoria y sin entidad, no hay dueño', () => {
    expect(entidadDe(tx({ categoryId: null }), indice)).toBe(null);
  });

  it('una categoria sin entidad tampoco lo asigna', () => {
    expect(entidadDe(tx({ categoryId: 'suelta' }), indice)).toBe(null);
  });

  it('CAMBIAR LA CATEGORIA RECLASIFICA LA HISTORIA SIN TOCAR MOVIMIENTOS', () => {
    // La razon de poner la entidad en la categoria: corregirse no exige
    // reescribir 44 registros.
    const movs = [tx({ categoryId: 'video', amountMinor: 55_924, type: TxType.GASTO })];
    const antes = resultadoPorEntidad(movs, cats).find((r) => r.entityId === 'buko');
    expect(antes?.gastoMinor).toBe(55_924);

    const corregidas = cats.map((c) => (c.id === 'video' ? { ...c, entityId: 'pc' } : c));
    const despues = resultadoPorEntidad(movs, corregidas);
    expect(despues.find((r) => r.entityId === 'buko')).toBeUndefined();
    expect(despues.find((r) => r.entityId === 'pc')?.gastoMinor).toBe(55_924);
    // Y el movimiento quedo igual.
    expect(movs[0].entityId).toBe(null);
  });
});

describe('resultadoPorEntidad', () => {
  // Las cifras reales del hogar, con la clasificacion que confirmaron.
  const cats = [
    categoria({ id: 'video', name: 'Video musical', type: 'gasto', entityId: 'buko' }),
    categoria({ id: 'susc', name: 'Suscripciones', type: 'gasto', entityId: 'pc' }),
    categoria({ id: 'pcIng', name: 'PanaClaw', type: 'ingreso', entityId: 'pc' }),
    categoria({ id: 'quincena', name: 'Quincena', type: 'ingreso', entityId: 'familia' }),
    categoria({ id: 'comida', name: 'Alimentos', type: 'gasto', entityId: 'familia' }),
  ];
  const movs = [
    tx({ type: TxType.GASTO, amountMinor: 55_924, categoryId: 'video' }),
    tx({ type: TxType.GASTO, amountMinor: 756, categoryId: 'susc' }),
    tx({ type: TxType.INGRESO, amountMinor: 50_000, categoryId: 'pcIng' }),
    tx({ type: TxType.INGRESO, amountMinor: 20_000, categoryId: 'quincena' }),
    tx({ type: TxType.GASTO, amountMinor: 14_736, categoryId: 'comida' }),
  ];

  it('separa las tres economias', () => {
    const r = resultadoPorEntidad(movs, cats);
    const de = (e: string) => r.find((x) => x.entityId === e)!;
    expect(de('pc').resultadoMinor).toBe(49_244);
    expect(de('buko').resultadoMinor).toBe(-55_924);
    expect(de('familia').resultadoMinor).toBe(5_264);
  });

  it('los tres resultados suman el total, sin perder nada', () => {
    const suma = resultadoPorEntidad(movs, cats).reduce((a, r) => a + r.resultadoMinor, 0);
    expect(suma).toBe(resumir(movs).flujoMinor);
  });

  it('lo que no tiene entidad se junta aparte y sigue contando', () => {
    const conHuerfano = [...movs, tx({ type: TxType.GASTO, amountMinor: 525, categoryId: null })];
    const r = resultadoPorEntidad(conHuerfano, cats);
    expect(r.find((x) => x.entityId === null)?.gastoMinor).toBe(525);
    expect(r.reduce((a, x) => a + x.resultadoMinor, 0)).toBe(resumir(conHuerfano).flujoMinor);
  });

  it('las transferencias entre cuentas propias no inflan ningun resultado', () => {
    const conTransfer = [...movs, tx({ type: TxType.TRANSFERENCIA, amountMinor: 20_500, categoryId: 'comida' })];
    const r = resultadoPorEntidad(conTransfer, cats).find((x) => x.entityId === 'familia')!;
    expect(r.resultadoMinor).toBe(5_264);
  });
});

describe('repartirEnJarras', () => {
  it('con todo en porcentaje da lo mismo que antes', () => {
    const jars = [jarra('j1', 5500, 0), jarra('j2', 3000, 1), jarra('j3', 1500, 2)];
    const r = repartirEnJarras(100_000, jars);
    expect(r.get('j1')).toBe(55_000);
    expect(r.get('j2')).toBe(30_000);
    expect(r.get('j3')).toBe(15_000);
  });

  it('el porcentaje se toma del bruto, no de lo que sobra', () => {
    // "20% de impuestos" tiene que ser el 20% de lo que se cobro.
    const jars = [
      jarra('imp', 2000, 0),
      jarra('pub', 0, 1, false, { fillKind: 'fijo', fillMinor: 10_000 }),
      jarra('ope', 0, 2, false, { fillKind: 'resto' }),
    ];
    const r = repartirEnJarras(100_000, jars);
    expect(r.get('imp')).toBe(20_000);
    expect(r.get('pub')).toBe(10_000);
    expect(r.get('ope')).toBe(70_000);
  });

  it('si el cobro es chico, el fijo toma lo que hay y nadie queda en negativo', () => {
    const jars = [
      jarra('imp', 2000, 0),
      jarra('pub', 0, 1, false, { fillKind: 'fijo', fillMinor: 10_000 }),
      jarra('ope', 0, 2, false, { fillKind: 'resto' }),
    ];
    const r = repartirEnJarras(5_000, jars);
    expect(r.get('imp')).toBe(1_000);
    expect(r.get('pub')).toBe(4_000);
    expect(r.get('ope') ?? 0).toBe(0);
    expect([...r.values()].every((v) => v >= 0)).toBe(true);
  });

  it('la suma da SIEMPRE el total exacto, con cualquier mezcla', () => {
    const jars = [
      jarra('a', 3333, 0),
      jarra('b', 3333, 1),
      jarra('c', 0, 2, false, { fillKind: 'fijo', fillMinor: 777 }),
      jarra('d', 0, 3, false, { fillKind: 'resto' }),
    ];
    for (let total = 0; total < 2000; total++) {
      const suma = [...repartirEnJarras(total, jars).values()].reduce((a, b) => a + b, 0);
      expect(suma).toBe(total);
    }
  });
});

describe('validarJarras con reglas de llenado', () => {
  it('sin jarra de resto, los porcentajes deben dar 100%', () => {
    expect(validarJarras([jarra('a', 5000, 0), jarra('b', 5000, 1)]).ok).toBe(true);
    expect(validarJarras([jarra('a', 5000, 0), jarra('b', 4000, 1)]).ok).toBe(false);
  });

  it('con jarra de resto alcanza con no pasarse de 100%', () => {
    const jars = [jarra('a', 2000, 0), jarra('b', 0, 1, false, { fillKind: 'resto' })];
    expect(validarJarras(jars).ok).toBe(true);
  });

  it('rechaza pasarse de 100% aunque haya resto', () => {
    const jars = [jarra('a', 11_000, 0), jarra('b', 0, 1, false, { fillKind: 'resto' })];
    expect(validarJarras(jars).ok).toBe(false);
  });

  it('un monto fijo sin jarra de resto no cierra', () => {
    const jars = [
      jarra('a', 10_000, 0),
      jarra('b', 0, 1, false, { fillKind: 'fijo', fillMinor: 5_000 }),
    ];
    const r = validarJarras(jars);
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('resto');
  });

  it('no puede haber dos jarras de resto', () => {
    const jars = [
      jarra('a', 0, 0, false, { fillKind: 'resto' }),
      jarra('b', 0, 1, false, { fillKind: 'resto' }),
    ];
    expect(validarJarras(jars).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cada economia reparte lo suyo
// ---------------------------------------------------------------------------

const entidad = (id: string, orden: number, p: Partial<Entity> = {}): Entity => ({
  id, householdId: 'h', name: id, kind: 'personal', color: '#000', icon: 'house',
  displayOrder: orden, archived: false, trashedAt: null, trashedBy: null, createdAt: 0, ...p,
});

describe('entidadPorDefecto', () => {
  it('es la primera de la lista, que es la casa', () => {
    const ents = [entidad('pc', 1), entidad('familia', 0), entidad('buko', 2)];
    expect(entidadPorDefecto(ents)).toBe('familia');
  });

  it('saltea las archivadas', () => {
    const ents = [entidad('vieja', 0, { archived: true }), entidad('familia', 1)];
    expect(entidadPorDefecto(ents)).toBe('familia');
  });

  it('sin entidades no hay ninguna', () => {
    expect(entidadPorDefecto([])).toBe(null);
  });
});

describe('jarrasDe', () => {
  const jars = [
    jarra('casa-1', 5000, 0, false, { entityId: 'familia' }),
    jarra('casa-2', 5000, 1, false, { entityId: 'familia' }),
    jarra('pc-imp', 2000, 0, true, { entityId: 'pc' }),
    jarra('pc-resto', 0, 1, false, { entityId: 'pc', fillKind: 'resto' }),
  ];

  it('un cobro del negocio no toca los frascos de la casa', () => {
    expect(jarrasDe(jars, 'pc', 'familia').map((j) => j.id))
      .toEqual(['pc-imp', 'pc-resto']);
  });

  it('sin entidad cae en la casa, que es lo que pasaba antes de los negocios', () => {
    expect(jarrasDe(jars, null, 'familia').map((j) => j.id))
      .toEqual(['casa-1', 'casa-2']);
  });

  it('una economia sin jarras no reparte en las de otra', () => {
    expect(jarrasDe(jars, 'buko', 'familia')).toEqual([]);
  });
});

describe('el reparto respeta la economia del movimiento', () => {
  const jars = [
    jarra('casa-nec', 5500, 0, false, { entityId: 'familia' }),
    jarra('casa-ahorro', 4500, 1, true, { entityId: 'familia' }),
    jarra('pc-imp', 2000, 0, true, { entityId: 'pc' }),
    jarra('pc-resto', 0, 1, true, { entityId: 'pc', fillKind: 'resto' }),
  ];
  const cats = [
    categoria({ id: 'cobro-pc', name: 'PanaClaw', type: 'ingreso', entityId: 'pc' }),
    categoria({ id: 'sueldo', name: 'Sueldo', type: 'ingreso', entityId: 'familia' }),
  ];
  const indice = indexarCategorias(cats);

  /** Lo mismo que hace el Worker: resolver la economia y repartir ahi. */
  const repartoDe = (t: Transaction) => imputacionJarras(
    t, jarrasDe(jars, entidadDe(t, indice), 'familia'),
  );

  it('un cobro de PanaClaw se parte entre las jarras de PanaClaw', () => {
    const partes = repartoDe(tx({
      type: TxType.INGRESO, amountMinor: 100_000, distributeToJars: true,
      categoryId: 'cobro-pc',
    }));
    expect([...partes]).toEqual([['pc-imp', 20_000], ['pc-resto', 80_000]]);
  });

  it('un sueldo de la casa se parte entre los frascos de la casa', () => {
    const partes = repartoDe(tx({
      type: TxType.INGRESO, amountMinor: 100_000, distributeToJars: true,
      categoryId: 'sueldo',
    }));
    expect([...partes]).toEqual([['casa-nec', 55_000], ['casa-ahorro', 45_000]]);
  });

  it('un ingreso sin categoria sigue cayendo en la casa', () => {
    const partes = repartoDe(tx({
      type: TxType.INGRESO, amountMinor: 100_000, distributeToJars: true,
    }));
    expect([...partes]).toEqual([['casa-nec', 55_000], ['casa-ahorro', 45_000]]);
  });

  it('NINGUNA ECONOMIA SE QUEDA CON PLATA DE OTRA', () => {
    // Lo que no puede pasar nunca: que un cobro del negocio aparezca sumado
    // en un frasco de la casa. Se prueba con los dos repartos juntos.
    const delNegocio = repartoDe(tx({
      type: TxType.INGRESO, amountMinor: 33_333, distributeToJars: true,
      categoryId: 'cobro-pc',
    }));
    const deLaCasa = repartoDe(tx({
      type: TxType.INGRESO, amountMinor: 77_777, distributeToJars: true,
      categoryId: 'sueldo',
    }));

    const suma = (m: Map<string, number>, pref: string) =>
      [...m].filter(([id]) => id.startsWith(pref)).reduce((t, [, v]) => t + v, 0);

    // Cada reparto entrega su total exacto, y solo dentro de su economia.
    expect(suma(delNegocio, 'pc-')).toBe(33_333);
    expect(suma(delNegocio, 'casa-')).toBe(0);
    expect(suma(deLaCasa, 'casa-')).toBe(77_777);
    expect(suma(deLaCasa, 'pc-')).toBe(0);
  });

  it('cada economia valida su 100% por separado', () => {
    // Las cuatro jarras juntas suman 120%, que no querria decir nada. Por
    // separado, cada tanda cierra.
    expect(validarJarras(jars).ok).toBe(false);
    expect(validarJarras(jarrasDe(jars, 'familia', null)).ok).toBe(true);
    expect(validarJarras(jarrasDe(jars, 'pc', null)).ok).toBe(true);
  });
});

describe('formatMonto nunca abrevia', () => {
  it('escribe el monto entero aunque pase los cinco dígitos', () => {
    expect(formatMonto(1_250_000, 'USD', { compacto: true })).toBe('$12,500');
    expect(formatMonto(1_254_937, 'USD', { compacto: true })).toBe('$12,549.37');
    expect(formatMonto(123_456_789, 'USD', { compacto: true })).toBe('$1,234,567.89');
  });

  it('compacto solo se saltea los centavos en cero', () => {
    expect(formatMonto(8000, 'USD', { compacto: true })).toBe('$80');
    expect(formatMonto(8012, 'USD', { compacto: true })).toBe('$80.12');
    expect(formatMonto(8000, 'USD')).toBe('$80.00');
  });
});
