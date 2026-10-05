/**
 * Rangos de tiempo para filtrar movimientos.
 *
 * Un solo tipo describe todos los casos (dia, semana, mes, año, rango libre),
 * asi las pantallas filtran siempre igual sin ramificar por cada uno.
 *
 * Todos los limites se calculan en hora local y de punta a punta del dia: el
 * inicio a las 00:00:00.000 y el fin a las 23:59:59.999. Si el fin se dejara
 * en 00:00, los movimientos del ultimo dia quedarian afuera, que es un error
 * silencioso y molesto de encontrar.
 */

export type TipoPeriodo = 'dia' | 'semana' | 'mes' | 'anio' | 'rango' | 'todo';

export interface Periodo {
  tipo: TipoPeriodo;
  /** Epoch del primer instante. */
  desde: number;
  /** Epoch del ultimo instante. */
  hasta: number;
}

const inicioDia = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();

const finDia = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();

export function periodoDia(epoch: number): Periodo {
  const d = new Date(epoch);
  return { tipo: 'dia', desde: inicioDia(d), hasta: finDia(d) };
}

/** Semana de lunes a domingo, que es como se piensa una semana aca. */
export function periodoSemana(epoch: number): Periodo {
  const d = new Date(epoch);
  // getDay() da 0 para domingo; se convierte para que el lunes sea el inicio.
  const desplazamiento = (d.getDay() + 6) % 7;
  const lunes = new Date(d.getFullYear(), d.getMonth(), d.getDate() - desplazamiento);
  const domingo = new Date(d.getFullYear(), d.getMonth(), d.getDate() - desplazamiento + 6);
  return { tipo: 'semana', desde: inicioDia(lunes), hasta: finDia(domingo) };
}

export function periodoMes(epoch: number): Periodo {
  const d = new Date(epoch);
  const primero = new Date(d.getFullYear(), d.getMonth(), 1);
  // Dia 0 del mes siguiente es el ultimo de este, sin importar cuantos tenga.
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { tipo: 'mes', desde: inicioDia(primero), hasta: finDia(ultimo) };
}

export function periodoAnio(epoch: number): Periodo {
  const d = new Date(epoch);
  return {
    tipo: 'anio',
    desde: inicioDia(new Date(d.getFullYear(), 0, 1)),
    hasta: finDia(new Date(d.getFullYear(), 11, 31)),
  };
}

/** Rango libre. Si vienen dados vuelta, se ordenan. */
export function periodoRango(a: number, b: number): Periodo {
  const [ini, fin] = a <= b ? [a, b] : [b, a];
  return { tipo: 'rango', desde: inicioDia(new Date(ini)), hasta: finDia(new Date(fin)) };
}

export const periodoTodo = (): Periodo => ({ tipo: 'todo', desde: 0, hasta: 8.64e15 });

/** Mueve un periodo hacia atras o adelante manteniendo su tipo. */
export function moverPeriodo(p: Periodo, pasos: number): Periodo {
  const d = new Date(p.desde);
  switch (p.tipo) {
    case 'dia':
      return periodoDia(new Date(d.getFullYear(), d.getMonth(), d.getDate() + pasos).getTime());
    case 'semana':
      return periodoSemana(new Date(d.getFullYear(), d.getMonth(), d.getDate() + pasos * 7).getTime());
    case 'mes':
      return periodoMes(new Date(d.getFullYear(), d.getMonth() + pasos, 1).getTime());
    case 'anio':
      return periodoAnio(new Date(d.getFullYear() + pasos, 0, 1).getTime());
    default:
      // Un rango libre o "todo" no tiene un siguiente evidente: se deja igual.
      return p;
  }
}

export const dentroDe = (epoch: number, p: Periodo): boolean =>
  epoch >= p.desde && epoch <= p.hasta;

const F_DIA = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const F_DIA_ANIO = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });

/** Texto corto del periodo, para el encabezado. */
export function describirPeriodo(p: Periodo): string {
  const d = new Date(p.desde);
  const anioActual = new Date().getFullYear();

  switch (p.tipo) {
    case 'dia': {
      const hoy = periodoDia(Date.now());
      if (hoy.desde === p.desde) return 'Hoy';
      const ayer = periodoDia(Date.now() - 86_400_000);
      if (ayer.desde === p.desde) return 'Ayer';
      return d.getFullYear() === anioActual ? F_DIA.format(d) : F_DIA_ANIO.format(d);
    }
    case 'semana':
      return `${F_DIA.format(d)} al ${F_DIA.format(new Date(p.hasta))}`;
    case 'mes':
      // Sin el año cuando es el de hoy: a 320px "Septiembre de 2026" no entra
      // y se cortaba justo el año, que es la parte que importa.
      return d.getFullYear() === anioActual
        ? d.toLocaleDateString('es', { month: 'long' })
        : d.toLocaleDateString('es', { month: 'long', year: 'numeric' });
    case 'anio':
      return String(d.getFullYear());
    case 'rango':
      return `${F_DIA.format(d)} al ${F_DIA.format(new Date(p.hasta))}`;
    default:
      return 'Todo';
  }
}
