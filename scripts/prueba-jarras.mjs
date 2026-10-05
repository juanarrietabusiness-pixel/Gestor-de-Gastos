/**
 * Prueba de las jarras contra un Worker de verdad.
 *
 * Lo que no pueden ver ni el typecheck ni los tests del nucleo: que las
 * imputaciones se escriban en la misma operacion que el movimiento, que
 * cambiar un porcentaje NO mueva el pasado, que el traspaso no toque cuentas,
 * y que jarras + sin asignar den siempre la plata real.
 *
 *   npx wrangler dev --local --port 8801 &
 *   node scripts/prueba-jarras.mjs http://127.0.0.1:8801
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:8801';
let cookie = '';
const fallos = [];
const ok = (n, c, d = '') => {
  console.log(`  ${c ? 'OK  ' : 'MAL '} ${n}${c ? '' : `  -> ${d}`}`);
  if (!c) fallos.push(n);
};

async function pedir(ruta, opciones = {}) {
  const res = await fetch(BASE + ruta, {
    ...opciones,
    headers: { ...(opciones.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
  const c = res.headers.get('set-cookie');
  if (c) cookie = c.split(';')[0];
  const t = await res.text();
  try { return { status: res.status, datos: t ? JSON.parse(t) : null }; } catch { return { status: res.status, datos: t }; }
}

async function derivar(password, email) {
  const enc = new TextEncoder();
  const m = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const b = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode('gg:v1:' + email.trim().toLowerCase()), iterations: 210_000, hash: 'SHA-256' }, m, 256);
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const jarra = (snap, nombre) => snap.jars.find((j) => j.name === nombre);
const totalJarras = (snap) => snap.jars.reduce((a, j) => a + j.balanceMinor, 0);
const enCuentas = (snap) => snap.accounts.filter((a) => !a.archived).reduce((a, c) => a + c.balanceMinor, 0);
const sinAsignar = (snap) => enCuentas(snap) - totalJarras(snap);

async function main() {
  console.log(`\nProbando contra ${BASE}\n`);
  const email = `jarras+${Date.now()}@ejemplo.test`;

  console.log('1. Hogar nuevo, con las seis jarras de la semilla');
  const alta = await pedir('/api/setup', {
    method: 'POST',
    body: JSON.stringify({
      email, password: await derivar('contraseña-larga', email), displayName: 'Abrinay',
      householdName: 'Casa', currency: 'USD', setupKey: 'clave-de-prueba',
    }),
  });
  if (alta.status !== 200) { console.log('  MAL  alta:', alta.status, JSON.stringify(alta.datos)); process.exit(1); }

  let snap = (await pedir('/api/snapshot')).datos;
  ok('la semilla trae 6 jarras', snap.jars.length === 6, snap.jars.length);
  ok('el snapshot trae imputaciones y traspasos',
     Array.isArray(snap.imputaciones) && Array.isArray(snap.jarTransfers));
  ok('Ahorro largo plazo acumula', jarra(snap, 'Ahorro largo plazo')?.acumula === true);
  ok('Necesidades no acumula', jarra(snap, 'Necesidades')?.acumula === false);

  const cuenta = (await pedir('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ name: 'BG principal', category: 2, currency: 'USD', initialBalanceMinor: 0 }),
  })).datos.account;

  console.log('\n2. Un ingreso repartido escribe sus imputaciones');
  const ing = await pedir('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ type: 2, amountMinor: 100_000, accountId: cuenta.id, date: Date.now(),
                           description: 'Quincena', distributeToJars: true }),
  });
  ok('devuelve las imputaciones', Array.isArray(ing.datos?.imputaciones) && ing.datos.imputaciones.length === 6,
     ing.datos?.imputaciones?.length);
  const suma = ing.datos.imputaciones.reduce((a, i) => a + i.amountMinor, 0);
  ok('el reparto suma exactamente el ingreso', suma === 100_000, suma);

  snap = (await pedir('/api/snapshot')).datos;
  ok('Necesidades quedo con el 55%', jarra(snap, 'Necesidades').balanceMinor === 55_000,
     jarra(snap, 'Necesidades').balanceMinor);
  ok('sin asignar quedo en cero: todo tiene trabajo', sinAsignar(snap) === 0, sinAsignar(snap));

  console.log('\n3. CAMBIAR UN PORCENTAJE NO REESCRIBE EL PASADO');
  const antes = jarra(snap, 'Ahorro largo plazo').balanceMinor;
  const nuevas = snap.jars.map((j) => ({
    ...j,
    percentageBp: j.name === 'Ahorro largo plazo' ? 2000
      : j.name === 'Necesidades' ? 4500 : j.percentageBp,
  }));
  const guardadas = await pedir('/api/jars', { method: 'PUT', body: JSON.stringify({ jars: nuevas }) });
  ok('se guardan los porcentajes nuevos', guardadas.status === 200, JSON.stringify(guardadas.datos));
  snap = (await pedir('/api/snapshot')).datos;
  ok('el saldo del ingreso viejo no se movio', jarra(snap, 'Ahorro largo plazo').balanceMinor === antes,
     `${antes} -> ${jarra(snap, 'Ahorro largo plazo').balanceMinor}`);
  ok('el porcentaje si cambio', jarra(snap, 'Ahorro largo plazo').percentageBp === 2000);

  console.log('\n4. El reparto nuevo usa los porcentajes nuevos');
  await pedir('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ type: 2, amountMinor: 100_000, accountId: cuenta.id, date: Date.now(),
                           description: 'Otra quincena', distributeToJars: true }),
  });
  snap = (await pedir('/api/snapshot')).datos;
  ok('Ahorro recibio 20% del segundo', jarra(snap, 'Ahorro largo plazo').balanceMinor === antes + 20_000,
     jarra(snap, 'Ahorro largo plazo').balanceMinor);

  console.log('\n5. Editar sin tocar el reparto no vuelve a congelar');
  const tx2 = snap.transactions.find((t) => t.description === 'Otra quincena');
  const impAntes = snap.imputaciones.filter((i) => i.txId === tx2.id).map((i) => `${i.jarId}:${i.amountMinor}`).sort();
  await pedir(`/api/transactions/${tx2.id}`, {
    method: 'PUT',
    body: JSON.stringify({ type: 2, amountMinor: 100_000, accountId: cuenta.id, date: tx2.date,
                           description: 'Otra quincena (corregida)', distributeToJars: true }),
  });
  snap = (await pedir('/api/snapshot')).datos;
  const impDespues = snap.imputaciones.filter((i) => i.txId === tx2.id).map((i) => `${i.jarId}:${i.amountMinor}`).sort();
  ok('las imputaciones quedaron iguales', JSON.stringify(impAntes) === JSON.stringify(impDespues));

  console.log('\n6. Cambiar el monto SI vuelve a repartir');
  await pedir(`/api/transactions/${tx2.id}`, {
    method: 'PUT',
    body: JSON.stringify({ type: 2, amountMinor: 200_000, accountId: cuenta.id, date: tx2.date,
                           description: 'Otra quincena', distributeToJars: true }),
  });
  snap = (await pedir('/api/snapshot')).datos;
  const nuevoTotal = snap.imputaciones.filter((i) => i.txId === tx2.id).reduce((a, i) => a + i.amountMinor, 0);
  ok('el reparto sigue al monto nuevo', nuevoTotal === 200_000, nuevoTotal);
  ok('sin asignar sigue en cero', sinAsignar(snap) === 0, sinAsignar(snap));

  console.log('\n7. Traspaso entre jarras');
  const nec = jarra(snap, 'Necesidades'), div = jarra(snap, 'Diversión');
  const cuentasAntes = enCuentas(snap);
  const tr = await pedir('/api/jar-transfers', {
    method: 'POST',
    body: JSON.stringify({ fromJarId: nec.id, toJarId: div.id, amountMinor: 5_000, note: 'me pasé' }),
  });
  ok('se guarda', tr.status === 201, JSON.stringify(tr.datos));
  snap = (await pedir('/api/snapshot')).datos;
  ok('sale de una', jarra(snap, 'Necesidades').balanceMinor === nec.balanceMinor - 5_000);
  ok('entra en la otra', jarra(snap, 'Diversión').balanceMinor === div.balanceMinor + 5_000);
  ok('NO toca ninguna cuenta', enCuentas(snap) === cuentasAntes, `${cuentasAntes} -> ${enCuentas(snap)}`);
  ok('no cambia sin asignar', sinAsignar(snap) === 0, sinAsignar(snap));
  ok('rechaza traspaso a la misma jarra',
     (await pedir('/api/jar-transfers', { method: 'POST', body: JSON.stringify({ fromJarId: nec.id, toJarId: nec.id, amountMinor: 100 }) })).status === 400);

  console.log('\n8. Borrar un movimiento devuelve la jarra');
  const totalAntes = totalJarras(snap);
  await pedir(`/api/transactions/${tx2.id}`, { method: 'DELETE' });
  snap = (await pedir('/api/snapshot')).datos;
  ok('las imputaciones se fueron con el', snap.imputaciones.filter((i) => i.txId === tx2.id).length === 0);
  ok('el total bajo exactamente el monto', totalJarras(snap) === totalAntes - 200_000,
     `${totalAntes} -> ${totalJarras(snap)}`);
  ok('sin asignar sigue cerrando', sinAsignar(snap) === 0, sinAsignar(snap));

  console.log('\n9. Gastos y la conciliacion en todos los casos');
  for (const [desc, cuerpo] of [
    ['gasto con jarra', { type: 3, amountMinor: 7_777, accountId: cuenta.id, jarId: nec.id }],
    ['gasto sin jarra', { type: 3, amountMinor: 1_234, accountId: cuenta.id }],
    ['ingreso a una jarra', { type: 2, amountMinor: 4_321, accountId: cuenta.id, jarId: div.id }],
    ['ingreso sin repartir', { type: 2, amountMinor: 9_999, accountId: cuenta.id }],
  ]) {
    await pedir('/api/transactions', {
      method: 'POST', body: JSON.stringify({ ...cuerpo, date: Date.now(), description: desc }),
    });
    snap = (await pedir('/api/snapshot')).datos;
    ok(`cierra tras ${desc}`, totalJarras(snap) + sinAsignar(snap) === enCuentas(snap),
       `${totalJarras(snap)} + ${sinAsignar(snap)} != ${enCuentas(snap)}`);
  }
  ok('sin asignar ya no es cero (hay plata sin trabajo)', sinAsignar(snap) > 0, sinAsignar(snap));

  console.log('\n10. Poner al dia los ingresos huerfanos');
  const huerfanosAntes = sinAsignar(snap);
  const puesta = await pedir('/api/jars/poner-al-dia', { method: 'POST' });
  ok('reparte el que quedo sin repartir', puesta.datos?.repartidos === 1, JSON.stringify(puesta.datos?.repartidos));
  snap = (await pedir('/api/snapshot')).datos;
  ok('sin asignar bajo justo ese monto', sinAsignar(snap) === huerfanosAntes - 9_999,
     `${huerfanosAntes} -> ${sinAsignar(snap)}`);
  ok('correrlo de nuevo no reparte nada',
     (await pedir('/api/jars/poner-al-dia', { method: 'POST' })).datos?.repartidos === 0);
  ok('no toco el que ya tenia jarra',
     snap.transactions.find((t) => t.description === 'ingreso a una jarra').distributeToJars === false);

  console.log();
  if (fallos.length) { console.log(`FALLARON ${fallos.length}: ${fallos.join(', ')}`); process.exit(1); }
  console.log('Todo bien.');
}

main().catch((e) => { console.error(e); process.exit(1); });
