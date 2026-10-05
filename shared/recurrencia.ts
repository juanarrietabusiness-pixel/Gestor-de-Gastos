/**
 * Calculo de fechas para los pagos habituales.
 *
 * Vive aparte y con tests propios porque las fechas recurrentes tienen una
 * trampa clasica: un pago el dia 31 en un mes que no tiene 31. Lo ingenuo es
 * hacer setDate(31) sobre febrero, y JavaScript desborda al 2 o 3 de marzo,
 * asi que el alquiler "del 31" termina apareciendo en marzo y el mes de
 * febrero queda sin el. Aca el dia se recorta al ultimo dia real del mes.
 *
 * Todas las fechas se calculan al mediodia local, no a medianoche: asi un
 * cambio de horario de verano no puede correr el pago al dia anterior.
 */

export type Frecuencia =
  | 'semanal' | 'quincenal' | 'mensual' | 'trimestral' | 'semestral' | 'anual';

/**
 * Las frecuencias en orden, de la mas seguida a la mas espaciada.
 *
 * El orden importa: es el de la lista que se elige en pantalla, y una lista de
 * periodos que no va de menor a mayor obliga a leerla entera cada vez.
 */
export const FRECUENCIAS: readonly Frecuencia[] = [
  'semanal', 'quincenal', 'mensual', 'trimestral', 'semestral', 'anual',
] as const;

export const FRECUENCIA_LABEL: Record<Frecuencia, string> = {
  semanal: 'Cada semana',
  quincenal: 'Cada quincena',
  mensual: 'Cada mes',
  trimestral: 'Cada trimestre',
  semestral: 'Cada semestre',
  anual: 'Cada año',
};

export const DIAS_SEMANA = [
  'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado',
] as const;

export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

/** Cuantos dias tiene un mes. El dia 0 del siguiente es el ultimo de este. */
export function diasDelMes(anio: number, mes0: number): number {
  return new Date(anio, mes0 + 1, 0).getDate();
}

/**
 * Arma una fecha recortando el dia al ultimo que exista en ese mes.
 * Pedir el 31 de febrero devuelve el 28 (o el 29 en año bisiesto).
 */
export function fechaSegura(anio: number, mes0: number, dia: number): Date {
  const tope = diasDelMes(anio, mes0);
  return new Date(anio, mes0, Math.min(dia, tope), 12, 0, 0, 0);
}

export interface ReglaRecurrencia {
  frecuencia: Frecuencia;
  /** 1-31, para quincenal, mensual y anual. */
  diaDelMes?: number;
  /** 1-31, el segundo cobro del mes. Solo quincenal. */
  diaDelMes2?: number;
  /** 0 = domingo, para semanal. */
  diaDeSemana?: number;
  /**
   * 1-12. El mes de referencia del ciclo, para trimestral, semestral y anual.
   *
   * En la anual es literalmente el mes en que se cobra. En las otras dos es el
   * ANCLA: marca en que punto del año arranca el ciclo, y a partir de ahi se
   * repite cada 3 o cada 6 meses. Con enero de ancla, la trimestral cae en
   * enero, abril, julio y octubre; con febrero, en febrero, mayo, agosto y
   * noviembre. Sin ancla no habria forma de distinguir esas dos.
   */
  mesDelAnio?: number;
}

/**
 * Cada cuantos meses se repite, para las frecuencias que se cuentan en meses.
 *
 * Son cuatro variantes de la MISMA regla —un dia del mes, cada N meses,
 * anclado a un mes del año— y por eso comparten el calculo entero en vez de
 * tener cada una su rama. La semanal y la quincenal no entran: la primera no
 * cuenta meses y la segunda cae dos veces dentro del mismo mes.
 */
const PASO_EN_MESES: Partial<Record<Frecuencia, number>> = {
  mensual: 1,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

/** Los meses (0-11) en los que cae un ciclo, a partir de su ancla. */
export function mesesDelCiclo(regla: ReglaRecurrencia): number[] {
  const paso = PASO_EN_MESES[regla.frecuencia];
  if (!paso || paso === 1) return [];
  const ancla = ((regla.mesDelAnio ?? 1) - 1 + 12) % 12;
  const out: number[] = [];
  for (let m = 0; m < 12; m += paso) out.push((ancla + m) % 12);
  return out.sort((a, b) => a - b);
}

/** Valores por defecto de la quincena: el 15 y el ultimo dia del mes. */
export const QUINCENA_POR_DEFECTO = [15, 31] as const;

/**
 * Los dos dias de una regla quincenal, ordenados.
 *
 * Se ordenan aca y no al guardar porque el orden es lo unico que hace que las
 * listas de candidatas de mas abajo salgan crecientes, y de eso depende que
 * "la primera posterior a X" sea de verdad la primera.
 */
function diasQuincena(regla: ReglaRecurrencia): [number, number] {
  const a = regla.diaDelMes ?? QUINCENA_POR_DEFECTO[0];
  const b = regla.diaDelMes2 ?? QUINCENA_POR_DEFECTO[1];
  return a <= b ? [a, b] : [b, a];
}

/**
 * Pasa un pago habitual guardado a la regla que entienden estas funciones.
 *
 * Existe porque esta traduccion se estaba escribiendo a mano en cuatro
 * lugares (el disparador, las dos rutas y la pantalla de ajustes) y ya habia
 * costado un error: la lista de Ajustes armaba la regla sin el segundo dia de
 * la quincena, asi que un sueldo del 1 y el 16 se describia como "el 1 y el
 * ultimo dia". Con una sola version, agregar un campo no puede olvidarse en
 * la mitad de los lugares.
 */
export function reglaDe(r: {
  frequency: Frecuencia;
  dayOfMonth?: number | null;
  dayOfMonth2?: number | null;
  dayOfWeek?: number | null;
  monthOfYear?: number | null;
}): ReglaRecurrencia {
  return {
    frecuencia: r.frequency,
    diaDelMes: r.dayOfMonth ?? undefined,
    diaDelMes2: r.dayOfMonth2 ?? undefined,
    diaDeSemana: r.dayOfWeek ?? undefined,
    mesDelAnio: r.monthOfYear ?? undefined,
  };
}

/**
 * Primera fecha de cobro a partir de un momento dado.
 * Si hoy es justo el dia, es hoy: un pago que arranca el 10 y se crea el 10 no
 * tiene que esperar al mes siguiente.
 */
export function primeraFecha(regla: ReglaRecurrencia, desde = Date.now()): number {
  const d = new Date(desde);
  const anio = d.getFullYear();
  const mes0 = d.getMonth();
  const hoy = new Date(anio, mes0, d.getDate(), 12, 0, 0, 0).getTime();

  switch (regla.frecuencia) {
    case 'semanal': {
      const objetivo = regla.diaDeSemana ?? 1;
      const faltan = (objetivo - d.getDay() + 7) % 7;
      return new Date(anio, mes0, d.getDate() + faltan, 12, 0, 0, 0).getTime();
    }

    case 'quincenal': {
      const [a, b] = diasQuincena(regla);
      // Crecientes: los dos de este mes y el primero del que viene, que
      // siempre cae despues. Con eso alcanza para cubrir cualquier "desde".
      const candidatas = [
        fechaSegura(anio, mes0, a).getTime(),
        fechaSegura(anio, mes0, b).getTime(),
        fechaSegura(anio, mes0 + 1, a).getTime(),
      ];
      return candidatas.find((f) => f >= hoy) ?? candidatas[2];
    }

    // Mensual, trimestral, semestral y anual: la misma cuenta con otro paso.
    default: {
      const paso = PASO_EN_MESES[regla.frecuencia];
      if (!paso) return hoy;

      const dia = regla.diaDelMes ?? 1;
      // La mensual cae todos los meses, asi que su ancla es este mismo mes y
      // el ciclo nunca la saltea. Las otras se anclan al mes elegido.
      const ancla = paso === 1 ? mes0 : (regla.mesDelAnio ?? 1) - 1;

      // En meses absolutos, para no pelearse con el cambio de año: el mes
      // 2026-03 es 24315, y sumarle 3 da 2026-06 sin ningun caso especial.
      const absHoy = anio * 12 + mes0;
      const absAncla = anio * 12 + ancla;
      // El primer mes del ciclo que no quedo atras. Ceil sobre la diferencia,
      // que puede ser negativa si el ancla es un mes que todavia no llego.
      const vueltas = Math.ceil((absHoy - absAncla) / paso);
      let abs = absAncla + vueltas * paso;

      let f = fechaSegura(Math.floor(abs / 12), abs % 12, dia).getTime();
      // Puede caer en el mes correcto pero en un dia ya pasado: se salta al
      // siguiente ciclo entero, no al mes siguiente.
      if (f < hoy) {
        abs += paso;
        f = fechaSegura(Math.floor(abs / 12), abs % 12, dia).getTime();
      }
      return f;
    }
  }
}

/**
 * Siguiente fecha despues de una que ya se cobro.
 *
 * Avanza SIEMPRE desde el dia pedido por la regla, no desde el dia en que
 * efectivamente cayo. Si no, un pago del 31 que en febrero cayo el 28 pasaria
 * a cobrarse el 28 para siempre, porque cada mes avanzaria desde el ultimo.
 */
export function siguienteFecha(regla: ReglaRecurrencia, ultima: number): number {
  const d = new Date(ultima);

  switch (regla.frecuencia) {
    case 'semanal':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7, 12, 0, 0, 0).getTime();

    case 'quincenal': {
      const [a, b] = diasQuincena(regla);
      const anio = d.getFullYear();
      const mes0 = d.getMonth();
      // No se mira que dia cayo, se busca la proxima candidata posterior. Es
      // lo unico que funciona cuando el dia se recorto: un cobro "el 31" que
      // en febrero cayo el 28 no coincide con ninguno de los dos numeros de
      // la regla, pero si es anterior al 15 de marzo, que es la que sigue.
      const candidatas = [
        fechaSegura(anio, mes0, a).getTime(),
        fechaSegura(anio, mes0, b).getTime(),
        fechaSegura(anio, mes0 + 1, a).getTime(),
        fechaSegura(anio, mes0 + 1, b).getTime(),
      ];
      // Estricto: si los dos dias caen en la misma fecha real (el 30 y el 31
      // en abril, por ejemplo) se cobra una sola vez y no dos el mismo dia.
      return candidatas.find((f) => f > ultima) ?? fechaSegura(anio, mes0 + 2, a).getTime();
    }

    // Mensual, trimestral, semestral y anual: sumarle el paso al mes.
    //
    // Se avanza desde el MES de la ultima, no desde el ancla, y el dia se
    // vuelve a tomar de la regla. Asi un cobro del 31 que en febrero cayo el
    // 28 sigue siendo "el 31" el mes que viene, y un ciclo que se atraso
    // varias vueltas las recupera de a una en vez de saltar al presente.
    default: {
      const paso = PASO_EN_MESES[regla.frecuencia];
      if (!paso) return ultima;
      return fechaSegura(
        d.getFullYear(),
        d.getMonth() + paso,
        regla.diaDelMes ?? d.getDate(),
      ).getTime();
    }
  }
}

/**
 * Todas las fechas vencidas hasta hoy, empezando por la que toca.
 *
 * Devuelve una lista porque puede haber mas de una: si nadie abre la app ni
 * corre el disparador durante dos meses, hay dos alquileres para crear, no
 * uno. El tope evita que un dato corrupto (una fecha del año 1990) genere
 * cientos de movimientos de golpe.
 */
export function fechasVencidas(
  regla: ReglaRecurrencia,
  proxima: number,
  hasta = Date.now(),
  tope = 24,
): number[] {
  const out: number[] = [];
  let fecha = proxima;

  while (fecha <= hasta && out.length < tope) {
    out.push(fecha);
    const siguiente = siguienteFecha(regla, fecha);
    // Guarda contra una regla que no avance: sin esto seria un bucle infinito.
    if (siguiente <= fecha) break;
    fecha = siguiente;
  }

  return out;
}

/** Texto legible de la regla, para mostrar en la lista de pagos. */
export function describirRegla(regla: ReglaRecurrencia): string {
  switch (regla.frecuencia) {
    case 'semanal':
      return `Cada ${DIAS_SEMANA[regla.diaDeSemana ?? 1].toLowerCase()}`;
    case 'quincenal': {
      const [a, b] = diasQuincena(regla);
      return `${a} y ${b === 31 ? 'último día' : b} del mes`;
    }
    case 'mensual':
      return `${regla.diaDelMes ?? 1} del mes`;
    case 'anual':
      return `${regla.diaDelMes ?? 1} de ${MESES[(regla.mesDelAnio ?? 1) - 1]}`;
    // Se nombran los cuatro (o los dos) meses en vez de decir "cada 3 meses".
    // "Cada 3 meses" no dice CUALES, y para un impuesto trimestral eso es lo
    // unico que hace falta saber para anticiparlo.
    case 'trimestral':
    case 'semestral': {
      const meses = mesesDelCiclo(regla).map((m) => MESES[m]);
      const listados = meses.length > 1
        ? `${meses.slice(0, -1).join(', ')} y ${meses[meses.length - 1]}`
        : meses[0];
      return `${regla.diaDelMes ?? 1} de ${listados}`;
    }
    default:
      return '';
  }
}
