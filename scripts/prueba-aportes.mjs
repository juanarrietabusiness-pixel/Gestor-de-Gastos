/**
 * Repartir en jarras plata que ya estaba en las cuentas.
 *
 * El caso real: la pantalla decia "Sin asignar $887.10" con TODOS los
 * movimientos asignados, porque eran los saldos iniciales de las cuentas y las
 * jarras solo ven movimientos.
 *
 *   node scripts/prueba-aportes.mjs http://127.0.0.1:8900
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:8900';
let cookie = '';
const fallos = [];
const ok = (n, c, d = '') => {
  console.log(`  ${c ? 'OK  ' : 'MAL '} ${n}${c ? '' : `  -> ${d}`}`);
  if (!c) fallos.push(n);
};
async function pedir(ruta, o = {}) {
  const res = await fetch(BASE + ruta, { ...o, headers: {
    ...(o.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) } });
  const c = res.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
  const t = await res.text();
  try { return { status: res.status, datos: JSON.parse(t) }; } catch { return { status: res.status, datos: t }; }
}
async function derivar(pw, email) {
  const enc = new TextEncoder();
  const m = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const b = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('gg:v1:' + email.trim().toLowerCase()),
    iterations: 210_000, hash: 'SHA-256' }, m, 256);
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const enJarras = (s) => s.jars.reduce((a, j) => a + j.balanceMinor, 0);
const enCuentas = (s) => s.accounts.filter((c) => !c.archived).reduce((a, c) => a + c.balanceMinor, 0);
const sinAsignar = (s) => enCuentas(s) - enJarras(s);

async function main() {
  console.log(`\nProbando contra ${BASE}\n`);
  const email = `apo+${Date.now()}@ejemplo.test`;
  const alta = await pedir('/api/setup', { method: 'POST', body: JSON.stringify({
    email, password: await derivar('contraseña-larga', email), displayName: 'Avalon',
    householdName: 'Casa', currency: 'USD', setupKey: 'clave-de-prueba' }) });
  if (alta.status !== 200) { console.log('MAL alta:', alta.status, JSON.stringify(alta.datos)); process.exit(1); }

  console.log('1. El caso de Avalon: cuentas con saldo inicial, cero movimientos');
  await pedir('/api/accounts', { method: 'POST', body: JSON.stringify({
    name: 'UGLYCASH', category: 2, currency: 'USD', initialBalanceMinor: 33284 }) });
  await pedir('/api/accounts', { method: 'POST', body: JSON.stringify({
    name: 'BG ahorros', category: 2, currency: 'USD', initialBalanceMinor: 31070 }) });
  await pedir('/api/accounts', { method: 'POST', body: JSON.stringify({
    name: 'BG principal', category: 2, currency: 'USD', initialBalanceMinor: 25139 }) });

  let snap = (await pedir('/api/snapshot')).datos;
  ok('no hay ni un movimiento', snap.transactions.length === 0);
  ok('y aun asi hay $894.93 sin asignar', sinAsignar(snap) === 89493, sinAsignar(snap));
  ok('las jarras están todas en cero', enJarras(snap) === 0, enJarras(snap));

  console.log('\n2. REPARTIRLO ENTRE LAS JARRAS');
  const familia = snap.entities[0].id;
  const r = await pedir('/api/jars/asignar', { method: 'POST', body: JSON.stringify({
    amountMinor: 89493, entityId: familia, note: 'Lo que ya teníamos' }) });
  ok('se reparte', r.status === 201, JSON.stringify(r.datos).slice(0, 150));
  ok('en las seis jarras', r.datos.aportes?.length === 6, r.datos.aportes?.length);

  snap = (await pedir('/api/snapshot')).datos;
  ok('SIN ASIGNAR QUEDA EN CERO', sinAsignar(snap) === 0, sinAsignar(snap));
  ok('y el total en jarras es exactamente lo que había', enJarras(snap) === 89493, enJarras(snap));
  ok('NO TOCÓ NINGUNA CUENTA', enCuentas(snap) === 89493, enCuentas(snap));
  ok('se repartió al centavo', r.datos.aportes.reduce((a, x) => a + x.amountMinor, 0) === 89493);

  const necesidades = snap.jars.find((j) => j.name === 'Necesidades');
  ok('Necesidades recibió el 55%', necesidades.balanceMinor === Math.floor(89493 * 0.55),
     `${necesidades.balanceMinor} vs ${Math.floor(89493 * 0.55)}`);

  console.log('\n3. Deshacerlo devuelve todo');
  for (const a of r.datos.aportes) {
    await pedir(`/api/jar-aportes/${a.id}`, { method: 'DELETE' });
  }
  snap = (await pedir('/api/snapshot')).datos;
  ok('las jarras vuelven a cero', enJarras(snap) === 0, enJarras(snap));
  ok('y el sin asignar vuelve entero', sinAsignar(snap) === 89493, sinAsignar(snap));
  ok('las cuentas nunca se movieron', enCuentas(snap) === 89493, enCuentas(snap));

  console.log('\n4. A una sola jarra');
  const ahorro = snap.jars.find((j) => j.name === 'Ahorro largo plazo');
  const u = await pedir('/api/jars/asignar', { method: 'POST', body: JSON.stringify({
    amountMinor: 50000, jarId: ahorro.id }) });
  ok('acepta una jarra puntual', u.status === 201, u.status);
  snap = (await pedir('/api/snapshot')).datos;
  ok('toda la plata va ahí',
     snap.jars.find((j) => j.id === ahorro.id).balanceMinor === 50000,
     snap.jars.find((j) => j.id === ahorro.id).balanceMinor);
  ok('y el sin asignar baja justo eso', sinAsignar(snap) === 89493 - 50000, sinAsignar(snap));

  console.log('\n5. Entradas inválidas');
  const cero = await pedir('/api/jars/asignar', { method: 'POST', body: JSON.stringify({ amountMinor: 0 }) });
  ok('rechaza monto cero', cero.status === 400, cero.status);
  const nada = await pedir('/api/jars/asignar', { method: 'POST', body: JSON.stringify({
    amountMinor: 1000, jarId: 'no-existe' }) });
  ok('rechaza una jarra que no existe', nada.status === 404, nada.status);
  const anon = await fetch(`${BASE}/api/jars/asignar`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountMinor: 100 }) });
  ok('exige sesión', anon.status === 401, anon.status);

  console.log();
  if (fallos.length) { console.log(`FALLARON ${fallos.length}: ${fallos.join(', ')}`); process.exit(1); }
  console.log('Todo bien.');
}
main().catch((e) => { console.error(e); process.exit(1); });
