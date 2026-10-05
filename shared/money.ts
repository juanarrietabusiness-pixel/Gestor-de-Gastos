/**
 * Aritmetica de dinero en enteros.
 *
 * Todo monto viaja y se guarda como un entero de unidades minimas (centavos
 * para USD). Nunca como float. Este archivo es el unico lugar autorizado a
 * convertir entre "lo que el usuario escribe" y "lo que se guarda".
 */

/** Cuantos decimales tiene cada moneda. La mayoria 2; el yen y el guarani, 0. */
const DECIMALES: Record<string, number> = {
  USD: 2, EUR: 2, ARS: 2, MXN: 2, CLP: 0, COP: 2, BRL: 2,
  UYU: 2, PEN: 2, GBP: 2, JPY: 0, PYG: 0,
};

export const decimalesDe = (currency: string): number => DECIMALES[currency] ?? 2;

const factor = (currency: string): number => 10 ** decimalesDe(currency);

/**
 * Convierte lo que escribio la persona a centavos.
 * Acepta "1.234,56", "1,234.56", "1234.56", "$ 1234", "1.234" y demas.
 *
 * El problema: en "1.234" el punto puede ser separador de miles (mil
 * doscientos treinta y cuatro) o decimal (uno coma dos). Se resuelve mirando
 * cual de los dos signos aparece ultimo: ese es el decimal.
 */
export function parseMonto(entrada: string, currency = 'USD'): number | null {
  const limpio = entrada.replace(/[^\d.,-]/g, '').trim();
  if (!limpio || limpio === '-') return null;

  const negativo = limpio.startsWith('-');
  const cuerpo = limpio.replace(/-/g, '');
  if (!cuerpo) return null;

  const ultimaComa = cuerpo.lastIndexOf(',');
  const ultimoPunto = cuerpo.lastIndexOf('.');

  let normalizado: string;
  if (ultimaComa === -1 && ultimoPunto === -1) {
    normalizado = cuerpo;
  } else {
    const posDecimal = Math.max(ultimaComa, ultimoPunto);
    const sufijo = cuerpo.slice(posDecimal + 1);
    // Un grupo de exactamente 3 digitos sin mas separadores despues es un
    // separador de miles ("1.234"), no un decimal. Salvo que sea el unico
    // separador y la moneda no tenga decimales.
    const esMiles = sufijo.length === 3 && !/[.,]/.test(sufijo) &&
      (cuerpo.match(/[.,]/g) ?? []).length >= 1 &&
      cuerpo.slice(0, posDecimal).replace(/[.,]/g, '').length <= 3 &&
      (ultimaComa === -1 || ultimoPunto === -1);

    if (esMiles) {
      normalizado = cuerpo.replace(/[.,]/g, '');
    } else {
      const enteros = cuerpo.slice(0, posDecimal).replace(/[.,]/g, '');
      normalizado = `${enteros}.${sufijo.replace(/[.,]/g, '')}`;
    }
  }

  const valor = Number(normalizado);
  if (!Number.isFinite(valor)) return null;

  // Redondeo en el ultimo paso, una sola vez, sobre el valor ya escalado.
  const minor = Math.round(valor * factor(currency));
  if (!Number.isSafeInteger(minor)) return null;
  return negativo ? -minor : minor;
}

/** Formatea centavos para mostrar. 123456 con USD -> "$1,234.56". */
export function formatMonto(
  minor: number,
  currency = 'USD',
  opciones: { signo?: boolean; compacto?: boolean } = {},
): string {
  const d = decimalesDe(currency);
  const valor = minor / 10 ** d;

  // "Compacto" es solo dejar de escribir los centavos cuando son cero: $80 en
  // vez de $80.00. Los que tienen centavos se muestran enteros, porque "$64.1"
  // no es plata, es un numero a medio escribir.
  //
  // Lo que NO hace es abreviar. Antes, pasando los $10.000, mostraba "$12.5K",
  // y eso es un monto que no se puede leer: no se sabe si son 12.500 o 12.549,
  // y en una pantalla de plata esa diferencia es plata. Un numero largo se
  // resuelve con el ancho de la columna, no escondiendo cifras.
  const redondo = minor % 10 ** d === 0;
  const decimales = opciones.compacto && redondo ? 0 : d;

  const fmt = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });

  const texto = fmt.format(Math.abs(valor));
  if (opciones.signo && minor !== 0) return `${minor > 0 ? '+' : '-'}${texto}`;
  return minor < 0 ? `-${texto}` : texto;
}

/** Solo el numero, sin simbolo. Para inputs. */
export function montoPlano(minor: number, currency = 'USD'): string {
  const d = decimalesDe(currency);
  return (minor / 10 ** d).toFixed(d);
}

/**
 * Reparte un monto entero entre varias partes porcentuales SIN perder ni
 * inventar un solo centavo.
 *
 * Este es el bug que tenia la version anterior. Con jarras de 2,5% y un
 * ingreso de $1.000,00 hacia `amount * (percentage / 100)` en floats: cada
 * jarra recibia 2.4999999... y la suma no daba $1.000,00. Repetido cada mes,
 * los frascos dejan de cuadrar con la cuenta y no hay forma de saber por que.
 *
 * La solucion es el metodo del mayor resto (el que usan los sistemas
 * electorales para repartir bancas): se da a cada parte su piso entero, y los
 * centavos sobrantes se entregan de a uno a quienes tengan el resto mas
 * grande. La suma da exacto por construccion, siempre.
 *
 * @param totalMinor monto entero a repartir
 * @param pesosBp    porcentajes en puntos base (2,5% = 250)
 * @returns          enteros que suman exactamente totalMinor
 */
export function repartir(totalMinor: number, pesosBp: number[]): number[] {
  if (pesosBp.length === 0) return [];

  const sumaBp = pesosBp.reduce((a, b) => a + b, 0);
  if (sumaBp <= 0) return pesosBp.map(() => 0);

  const negativo = totalMinor < 0;
  const total = Math.abs(totalMinor);

  const pisos: number[] = [];
  const restos: { i: number; resto: number }[] = [];
  let repartido = 0;

  for (let i = 0; i < pesosBp.length; i++) {
    const exacto = total * pesosBp[i];
    const piso = Math.floor(exacto / sumaBp);
    pisos.push(piso);
    repartido += piso;
    restos.push({ i, resto: exacto % sumaBp });
  }

  // Los centavos que sobraron por redondear hacia abajo.
  let sobrante = total - repartido;

  // Mayor resto primero. A igualdad de resto, gana el de menor indice para que
  // el reparto sea determinista (mismo input -> mismo output, siempre).
  restos.sort((a, b) => (b.resto - a.resto) || (a.i - b.i));

  for (let k = 0; k < restos.length && sobrante > 0; k++) {
    pisos[restos[k].i] += 1;
    sobrante--;
  }

  return negativo ? pisos.map((v) => -v) : pisos;
}

/** Suma segura: avisa si se pasa del rango entero seguro de JS. */
export function sumarMinor(...valores: number[]): number {
  const total = valores.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total)) {
    throw new RangeError('El monto acumulado supera el entero seguro de JavaScript');
  }
  return total;
}

/** Porcentaje en puntos base a texto legible: 250 -> "2,5%". */
/**
 * Un porcentaje, siempre entero.
 *
 * Los puntos base admiten decimales —2550 es 25,5%— pero una jarra con «25,5%
 * de cada ingreso» no se lee, se descifra. Los porcentajes que se eligen a
 * mano son enteros; el redondeo al centavo lo resuelve el reparto, no la
 * etiqueta.
 */
export function formatBp(bp: number): string {
  return `${Math.round(bp / 100)}%`;
}
