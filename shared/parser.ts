/**
 * Lectura de gastos escritos en lenguaje natural, sin IA externa.
 *
 * Reemplaza la llamada a Gemini de la version anterior (que ademas estaba rota:
 * el cliente pegaba a /api/categorize y el servidor solo exponia
 * /api/parse-transaction, asi que siempre caia en el catch y devolvia
 * "General").
 *
 * Esto corre en el dispositivo, sin red, en microsegundos y sin costo. Y como
 * aprende del historial propio de la pareja, acierta mas que un modelo
 * generico: si "chino" siempre fue Comida en esta casa, la segunda vez ya lo
 * sabe.
 */

import { TxType, type Category, type Transaction } from './types.ts';
import { parseMonto } from './money.ts';

export interface Lectura {
  amountMinor: number | null;
  description: string;
  categoryId: string | null;
  type: TxType;
  /** Por que se eligio esa categoria. Se muestra para que se pueda corregir. */
  razon: 'historial' | 'palabra-clave' | 'ninguna';
}

/**
 * Pistas por palabra clave. Es el arranque en frio: sirve hasta que haya
 * historial propio, que siempre le gana.
 */
const PISTAS: { palabras: string[]; categoria: string }[] = [
  { categoria: 'Comida', palabras: ['super', 'supermercado', 'almacen', 'verduleria', 'carniceria', 'panaderia', 'cafe', 'café', 'bar', 'resto', 'restaurante', 'delivery', 'pizza', 'empanada', 'mercado', 'comida', 'almuerzo', 'cena', 'desayuno', 'helado', 'chino', 'kiosco'] },
  { categoria: 'Transporte', palabras: ['nafta', 'combustible', 'sube', 'colectivo', 'subte', 'tren', 'taxi', 'uber', 'cabify', 'didi', 'peaje', 'estacionamiento', 'cochera', 'pasaje', 'vtv', 'mecanico', 'gomeria'] },
  { categoria: 'Hogar', palabras: ['alquiler', 'expensas', 'luz', 'gas', 'agua', 'internet', 'wifi', 'cable', 'telefono', 'celular', 'limpieza', 'ferreteria', 'mueble', 'electrodomestico', 'reparacion'] },
  { categoria: 'Salud', palabras: ['farmacia', 'remedio', 'medico', 'doctor', 'dentista', 'obra social', 'prepaga', 'analisis', 'oculista', 'psicologo', 'kinesiologo'] },
  { categoria: 'Ocio', palabras: ['cine', 'netflix', 'spotify', 'disney', 'hbo', 'max', 'youtube', 'juego', 'steam', 'salida', 'boliche', 'concierto', 'recital', 'teatro', 'libro', 'streaming'] },
  { categoria: 'Compras', palabras: ['ropa', 'zapatillas', 'zapatos', 'camisa', 'pantalon', 'regalo', 'amazon', 'mercadolibre', 'shopping', 'perfume', 'accesorio'] },
  { categoria: 'Mascotas', palabras: ['veterinaria', 'veterinario', 'alimento balanceado', 'gato', 'perro', 'mascota', 'arena'] },
  { categoria: 'Sueldo', palabras: ['sueldo', 'salario', 'honorarios', 'cobro', 'pago cliente', 'factura', 'aguinaldo', 'bono'] },
];

/** Palabras que indican que es plata que entra, no que sale. */
const SENALES_INGRESO = [
  'sueldo', 'salario', 'cobre', 'cobro', 'cobré', 'ingreso', 'me pagaron',
  'deposito', 'depósito', 'transferencia recibida', 'aguinaldo', 'bono',
  'honorarios', 'vendi', 'vendí', 'venta', 'reintegro', 'devolucion', 'devolución',
];

const SENALES_TRANSFERENCIA = [
  'transferi', 'transferí', 'transferencia a', 'pase a', 'pasé a', 'mover a', 'movi a', 'moví a',
];

/** Quita tildes y baja a minusculas para comparar sin sorpresas. */
const normalizar = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Separa el monto del resto del texto.
 * "café 3500" -> monto 3500, texto "café"
 * "3500 café" -> lo mismo
 * "pague 1.250,50 de luz" -> monto 125050, texto "pague de luz"
 */
function extraerMonto(texto: string, currency: string): { minor: number | null; resto: string } {
  // Busca numeros con separadores opcionales. El ultimo numero suele ser el
  // monto salvo que haya uno solo.
  const candidatos = [...texto.matchAll(/(?<![\w])(\d[\d.,]*)(?![\w])/g)];
  if (candidatos.length === 0) return { minor: null, resto: texto };

  // Prefiere el numero mas "grande" textualmente: descarta cosas como el "2"
  // de "2 cafes" cuando hay tambien un "3500".
  const elegido = candidatos.reduce((mejor, c) =>
    c[1].replace(/\D/g, '').length >= mejor[1].replace(/\D/g, '').length ? c : mejor,
  );

  const minor = parseMonto(elegido[1], currency);
  const resto = (texto.slice(0, elegido.index) + ' ' + texto.slice(elegido.index + elegido[1].length))
    .replace(/\s+/g, ' ')
    .trim();

  return { minor, resto };
}

function detectarTipo(textoNorm: string): TxType {
  if (SENALES_TRANSFERENCIA.some((s) => textoNorm.includes(normalizar(s)))) {
    return TxType.TRANSFERENCIA;
  }
  if (SENALES_INGRESO.some((s) => textoNorm.includes(normalizar(s)))) {
    return TxType.INGRESO;
  }
  return TxType.GASTO; // Lo mas probable por lejos.
}

/**
 * Busca en el historial una transaccion con descripcion parecida y reusa su
 * categoria. Solo mira las ultimas 400: alcanza de sobra y mantiene el parser
 * instantaneo aunque haya anios de datos.
 */
function categoriaPorHistorial(
  textoNorm: string,
  historial: Transaction[],
  tipo: TxType,
): string | null {
  if (!textoNorm) return null;

  const palabras = textoNorm.split(/\s+/).filter((p) => p.length >= 3);
  if (palabras.length === 0) return null;

  const puntajes = new Map<string, number>();

  for (const tx of historial.slice(0, 400)) {
    if (!tx.categoryId || tx.type !== tipo) continue;
    const descNorm = normalizar(tx.description);

    let coincidencias = 0;
    for (const p of palabras) {
      if (descNorm.includes(p)) coincidencias++;
    }
    if (coincidencias === 0) continue;

    // Cuenta cuantas palabras de la entrada aparecen, y le da mas peso a las
    // coincidencias completas de descripcion.
    const peso = coincidencias / palabras.length + (descNorm === textoNorm ? 1 : 0);
    puntajes.set(tx.categoryId, (puntajes.get(tx.categoryId) ?? 0) + peso);
  }

  if (puntajes.size === 0) return null;
  return [...puntajes.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function categoriaPorPistas(
  textoNorm: string,
  categories: Category[],
  tipo: TxType,
): string | null {
  const buscado = tipo === TxType.INGRESO ? 'ingreso' : 'gasto';

  for (const pista of PISTAS) {
    if (!pista.palabras.some((p) => textoNorm.includes(normalizar(p)))) continue;

    const cat = categories.find(
      (c) => !c.archived && c.type === buscado && normalizar(c.name) === normalizar(pista.categoria),
    );
    if (cat) return cat.id;
  }
  return null;
}

/** Primera letra en mayuscula, el resto como vino. */
const capitalizar = (s: string): string =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);

/**
 * Lee una frase y devuelve todo lo que pudo deducir.
 * Nunca falla: si no entiende algo lo deja en null y la persona lo completa.
 */
export function leer(
  entrada: string,
  opciones: {
    categories: Category[];
    historial: Transaction[];
    currency?: string;
  },
): Lectura {
  const { categories, historial, currency = 'USD' } = opciones;
  const texto = entrada.trim();

  const { minor, resto } = extraerMonto(texto, currency);
  const restoNorm = normalizar(resto);
  const tipo = detectarTipo(normalizar(texto));

  // Saca las palabras que solo indican el tipo, no de que se trata el gasto.
  const descripcion = capitalizar(
    resto
      .replace(/\b(pague|pagué|gaste|gasté|compre|compré|cobre|cobré|me pagaron|de|en|por|el|la|los|las|un|una)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ) || capitalizar(resto) || 'Movimiento';

  let categoryId = categoriaPorHistorial(restoNorm, historial, tipo);
  let razon: Lectura['razon'] = 'historial';

  if (!categoryId) {
    categoryId = categoriaPorPistas(restoNorm, categories, tipo);
    razon = categoryId ? 'palabra-clave' : 'ninguna';
  }

  return { amountMinor: minor, description: descripcion, categoryId, type: tipo, razon };
}
