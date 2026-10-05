/**
 * Que toda pantalla que muestre plata respete la economia elegida.
 *
 * El bug que esto evita ya paso: Inicio dibujaba el selector de economia pero
 * nunca leia `entidadActiva`, asi que tocar "PanaClaw" pintaba la pastilla y
 * dejaba todos los numeros igual. Un filtro que no filtra es peor que no
 * tenerlo: hace desconfiar de los numeros que si estan bien.
 *
 * Antes se revisaba que la pantalla que DIBUJA el selector lo use. Ese chequeo
 * quedo vacio el dia que el selector se mudo a la cabecera: como ya no lo
 * dibuja nadie, no fallaba nunca. Y el riesgo crecio, porque ahora el selector
 * es global y afecta a pantallas que ni saben que existe.
 *
 * Asi que la lista es explicita: estas cuatro leen movimientos y tienen que
 * filtrar. Sumar una pantalla nueva de plata es sumarla aca.
 *
 * Ni los tests de dominio ni el typecheck lo agarran —`filtrarPorEntidad` esta
 * probada y el codigo compila igual sin llamarla—, asi que se revisa el texto.
 *
 *   node scripts/prueba-filtros.mjs
 */

import { readFileSync } from 'node:fs';

/** Pantallas que muestran plata y por lo tanto deben respetar la economia. */
const OBLIGADAS = [
  'src/pages/Inicio.tsx',
  'src/pages/Movimientos.tsx',
  'src/pages/Jarras.tsx',
  'src/pages/Analisis.tsx',
];

const fallos = [];

for (const ruta of OBLIGADAS) {
  let codigo;
  try {
    codigo = readFileSync(ruta, 'utf8');
  } catch {
    fallos.push(`${ruta}: no existe. Si la renombraron, actualizá esta lista.`);
    continue;
  }

  // El cuerpo del componente exportado de la pantalla: desde su `export
  // function` hasta la siguiente funcion de nivel superior. Las auxiliares
  // (FilaMovimiento, las hojas) pueden leer la entidad para otra cosa —pintar
  // una etiqueta, por ejemplo— y eso no es que la pantalla filtre.
  const inicio = codigo.search(/^export function /m);
  if (inicio < 0) {
    fallos.push(`${ruta}: no se encontró el componente exportado`);
    continue;
  }
  const resto = codigo.slice(inicio + 1);
  const fin = resto.search(/^(export )?function /m);
  const principal = fin > 0 ? resto.slice(0, fin) : resto;

  const usa = principal.includes('filtrarPorEntidad')
    || /entidadActiva\s*(===|!==|\?\?|\)|,|\])/.test(principal);

  if (!usa) fallos.push(`${ruta}: muestra plata pero no usa entidadActiva`);
}

// Y que la pastilla siga estando en algun lado: si desaparece del armazon, la
// economia se vuelve inelegible y las pantallas quedan clavadas en una.
const armazon = readFileSync('src/components/layout/AppLayout.tsx', 'utf8');
if (!armazon.includes('<PastillaEntidad')) {
  fallos.push('src/components/layout/AppLayout.tsx: no dibuja <PastillaEntidad />, '
    + 'así que no hay forma de cambiar de economía');
}

if (fallos.length) {
  console.error('\nFiltro de economia sin conectar:\n');
  for (const f of fallos) console.error('  ' + f);
  console.error('');
  process.exit(1);
}

console.log(`Las ${OBLIGADAS.length} pantallas de plata respetan la economía, y la pastilla está en su lugar.`);
