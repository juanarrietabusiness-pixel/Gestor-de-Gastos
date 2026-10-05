/**
 * Presupuestos por evento, contra un Worker de verdad.
 *
 * Lo que se prueba: que un evento mida SOLO lo que se le carga a proposito, y
 * que borrarlo no se lleve puesto ningun gasto. «Viaje a Cancún» no puede
 * sumar el alquiler de casa solo porque cayo en las mismas fechas.
 *
 *   npx wrangler dev --local --port 8857 &
 *   node scripts/prueba-eventos.mjs http://127.0.0.1:8857
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:8857';
let cookie = '';
const fallos = [];
const ok = (n, c, d = '') => {
  console.log(`  ${c ? 'OK  ' : 'MAL '} ${n}${c ? '' : `  -> ${d}`}`);
  if (!c) fallos.push(n);
};
async function pedir(ruta, opciones = {}) {
  const res = await fetch(BASE + ruta, { ...opciones, headers: {
    ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}) } });
  const c = res.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
  const t = await res.text();
  try { return { status: res.status, datos: t ? JSON.parse(t) : null }; }
  catch { return { status: res.status, datos: t }; }
}
async function derivar(password, email) {
  const enc = new TextEncoder();
  const m = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const b = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('gg:v1:' + email.trim().toLowerCase()),
    iterations: 210_000, hash: 'SHA-256' }, m, 256);
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function main() {
  console.log(`\nProbando contra ${BASE}\n`);
  const email = `ev+${Date.now()}@ejemplo.test`;
  const alta = await pedir('/api/setup', { method: 'POST', body: JSON.stringify({
    email, password: await derivar('contraseña-larga', email), displayName: 'Abrinay',
    householdName: 'Casa', currency: 'USD', setupKey: 'clave-de-prueba' }) });
  if (alta.status !== 200) { console.log('MAL alta:', alta.status, JSON.stringify(alta.datos)); process.exit(1); }

  let snap = (await pedir('/api/snapshot')).datos;
  const familia = snap.entities[0].id;
  const cuenta = (await pedir('/api/accounts', { method: 'POST', body: JSON.stringify({
    name: 'Banco', category: 2, currency: 'USD', initialBalanceMinor: 500_00 }) })).datos.account;
  const cat = (await pedir('/api/categories', { method: 'POST', body: JSON.stringify({
    name: 'Viajes', type: 'gasto', entityId: familia }) })).datos.category;

  console.log('1. Crear el evento');
  let r = await pedir('/api/budgets', { method: 'PUT', body: JSON.stringify({
    name: 'Viaje a Cancún', amountMinor: 200_000 }) });
  ok('acepta nombre y tope, sin mes ni categoría', r.status === 200, `${r.status} ${JSON.stringify(r.datos)}`);
  const evento = r.datos.budget;
  ok('guarda el nombre', evento?.name === 'Viaje a Cancún', JSON.stringify(evento));
  ok('nace abierto', evento?.closedAt === null, String(evento?.closedAt));
  ok('sin categoría', evento?.categoryId === null, String(evento?.categoryId));

  console.log('\n2. SOLO cuenta lo que se le carga a propósito');
  const gasto = async (desc, monto, budgetId) => (await pedir('/api/transactions', {
    method: 'POST', body: JSON.stringify({
      type: 3, amountMinor: monto, description: desc, categoryId: cat.id,
      accountId: cuenta.id, date: Date.now(), budgetId: budgetId ?? null }) })).datos;

  await gasto('Hotel', 80_00, evento.id);
  await gasto('Excursión', 45_00, evento.id);
  // Este cae el MISMO día y en la MISMA categoría, pero no es del viaje.
  await gasto('Alquiler de casa', 450_00, null);

  snap = (await pedir('/api/snapshot')).datos;
  const delEvento = snap.transactions.filter((t) => t.budgetId === evento.id);
  const suma = delEvento.reduce((a, t) => a + t.amountMinor, 0);
  ok('cuenta los dos del viaje', delEvento.length === 2, `${delEvento.length}`);
  ok('suma $125.00 y NO $575.00', suma === 125_00, `${(suma / 100).toFixed(2)}`);
  ok('el alquiler quedó fuera aunque es del mismo día y categoría',
    !delEvento.some((t) => t.description === 'Alquiler de casa'));

  console.log('\n3. Cerrar y reabrir');
  r = await pedir('/api/budgets', { method: 'PUT', body: JSON.stringify({
    id: evento.id, name: 'Viaje a Cancún', amountMinor: 200_000, closedAt: Date.now() }) });
  ok('se cierra', typeof r.datos?.budget?.closedAt === 'number', JSON.stringify(r.datos?.budget));
  r = await pedir('/api/budgets', { method: 'PUT', body: JSON.stringify({
    id: evento.id, name: 'Viaje a Cancún', amountMinor: 200_000, closedAt: null }) });
  ok('se reabre', r.datos?.budget?.closedAt === null, String(r.datos?.budget?.closedAt));

  console.log('\n4. BORRARLO NO SE LLEVA NINGÚN GASTO');
  const antes = (await pedir('/api/snapshot')).datos.transactions.length;
  r = await pedir(`/api/budgets/${evento.id}`, { method: 'DELETE' });
  ok('se borra', r.status === 200, String(r.status));
  snap = (await pedir('/api/snapshot')).datos;
  ok('los 3 movimientos siguen ahí', snap.transactions.length === antes,
    `${snap.transactions.length} vs ${antes}`);
  ok('y perdieron solo el vínculo', snap.transactions.every((t) => !t.budgetId),
    JSON.stringify(snap.transactions.map((t) => t.budgetId)));
  const saldo = snap.accounts.reduce((a, c) => a + c.balanceMinor, 0);
  ok('el saldo no se movió: $-75.00', saldo === -75_00, `${(saldo / 100).toFixed(2)}`);

  console.log('\n5. Entradas inválidas');
  r = await pedir('/api/transactions', { method: 'POST', body: JSON.stringify({
    type: 3, amountMinor: 100, description: 'x', accountId: cuenta.id,
    date: Date.now(), budgetId: 'inventado' }) });
  ok('rechaza un presupuesto que no existe', r.status === 404, String(r.status));

  console.log(fallos.length ? `\nHay ${fallos.length} fallo(s).\n` : '\nTodo bien.\n');
  process.exit(fallos.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
