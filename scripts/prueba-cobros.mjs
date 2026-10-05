/**
 * Confirmar y deshacer el cobro de un pago habitual, y los topes por economia.
 *
 * Lo que se prueba es que el saldo NO mienta: si el jefe no pago, la plata no
 * puede estar en la cuenta ni repartida en las jarras.
 *
 *   npx wrangler dev --local --port 8850 &
 *   node scripts/prueba-cobros.mjs http://127.0.0.1:8850
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:8850';
let cookie = '';
const fallos = [];
const ok = (n, c, d = '') => {
  console.log(`  ${c ? 'OK  ' : 'MAL '} ${n}${c ? '' : `  -> ${d}`}`);
  if (!c) fallos.push(n);
};

async function pedir(ruta, opciones = {}) {
  const res = await fetch(BASE + ruta, { ...opciones, headers: {
    ...(opciones.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) } });
  const c = res.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
  const t = await res.text();
  try { return { status: res.status, datos: t ? JSON.parse(t) : null }; } catch { return { status: res.status, datos: t }; }
}
async function derivar(password, email) {
  const enc = new TextEncoder();
  const m = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const b = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('gg:v1:' + email.trim().toLowerCase()),
    iterations: 210_000, hash: 'SHA-256' }, m, 256);
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const saldo = (snap) => snap.accounts.filter((c) => !c.archived)
  .reduce((a, c) => a + c.balanceMinor, 0);
const enJarras = (snap) => snap.jars.reduce((a, j) => a + j.balanceMinor, 0);

async function main() {
  console.log(`\nProbando contra ${BASE}\n`);
  const email = `cob+${Date.now()}@ejemplo.test`;
  const alta = await pedir('/api/setup', { method: 'POST', body: JSON.stringify({
    email, password: await derivar('contraseña-larga', email), displayName: 'Abrinay',
    householdName: 'Casa', currency: 'USD', setupKey: 'clave-de-prueba' }) });
  if (alta.status !== 200) { console.log('MAL alta:', alta.status, JSON.stringify(alta.datos)); process.exit(1); }

  let snap = (await pedir('/api/snapshot')).datos;
  const familia = snap.entities[0].id;
  const cuenta = (await pedir('/api/accounts', { method: 'POST', body: JSON.stringify({
    name: 'BG principal', category: 2, currency: 'USD', initialBalanceMinor: 0 }) })).datos.account;
  const sueldo = (await pedir('/api/categories', { method: 'POST', body: JSON.stringify({
    name: 'Quincena', type: 'ingreso', entityId: familia }) })).datos.category;

  console.log('1. Un sueldo quincenal que reparte en jarras');
  const r = (await pedir('/api/recurring', { method: 'POST', body: JSON.stringify({
    name: 'Quincena', type: 2, amountMinor: 100000, accountId: cuenta.id,
    categoryId: sueldo.id, frequency: 'quincenal', distributeToJars: true,
    // Dentro de un mes: asi el disparador no lo toca durante la prueba.
    startAt: Date.now() + 30 * 86_400_000 }) })).datos.recurring;
  ok('se crea', r?.name === 'Quincena', JSON.stringify(r).slice(0, 120));
  ok('nace sin nada esperando', r.esperandoDesde === null, r.esperandoDesde);

  snap = (await pedir('/api/snapshot')).datos;
  const saldo0 = saldo(snap);
  const jarras0 = enJarras(snap);
  const proxima0 = r.nextRun;

  console.log('\n2. YA ME PAGARON, ANTES DE LA FECHA');
  const c = await pedir(`/api/recurring/cobrar/${r.id}`, { method: 'POST', body: JSON.stringify({}) });
  ok('confirma', c.status === 201, JSON.stringify(c.datos).slice(0, 150));
  snap = (await pedir('/api/snapshot')).datos;
  ok('la plata entra en la cuenta', saldo(snap) === saldo0 + 100000, saldo(snap) - saldo0);
  ok('Y SE REPARTE EN LAS JARRAS', enJarras(snap) === jarras0 + 100000, enJarras(snap) - jarras0);
  ok('el movimiento queda atado al pago habitual',
     snap.transactions.filter((t) => t.recurringId === r.id).length === 1);
  const r1 = snap.recurring.find((x) => x.id === r.id);
  ok('la próxima fecha AVANZA: ese ciclo quedó consumido', r1.nextRun > proxima0,
     `${proxima0} -> ${r1.nextRun}`);

  console.log('\n3. Contra el doble toque');
  const dup = await pedir(`/api/recurring/cobrar/${r.id}`, { method: 'POST', body: JSON.stringify({}) });
  ok('rechaza un cobro igual el mismo día', dup.status === 409, dup.status);

  console.log('\n4. TODAVÍA NO ME PAGARON: deshacer');
  const d = await pedir(`/api/recurring/deshacer/${r.id}`, { method: 'POST', body: JSON.stringify({}) });
  ok('deshace', d.status === 200, JSON.stringify(d.datos).slice(0, 150));
  snap = (await pedir('/api/snapshot')).datos;
  ok('EL SALDO VUELVE EXACTO', saldo(snap) === saldo0, saldo(snap) - saldo0);
  ok('LAS JARRAS TAMBIÉN', enJarras(snap) === jarras0, enJarras(snap) - jarras0);
  ok('no queda ningún movimiento del pago habitual',
     snap.transactions.filter((t) => t.recurringId === r.id).length === 0);
  const r2 = snap.recurring.find((x) => x.id === r.id);
  ok('queda anotado que se esperaba', r2.esperandoDesde !== null, r2.esperandoDesde);
  ok('la próxima fecha NO retrocede: si no, el disparador lo recrearía',
     r2.nextRun === r1.nextRun, `${r1.nextRun} -> ${r2.nextRun}`);

  console.log('\n5. Llegó tarde: confirmar lo que estaba esperando');
  const c2 = await pedir(`/api/recurring/cobrar/${r.id}`, { method: 'POST', body: JSON.stringify({
    amountMinor: 120000 }) });
  ok('acepta un monto distinto al habitual', c2.status === 201, c2.status);
  snap = (await pedir('/api/snapshot')).datos;
  ok('entra el monto real, no el teórico', saldo(snap) === saldo0 + 120000, saldo(snap) - saldo0);
  const r3 = snap.recurring.find((x) => x.id === r.id);
  ok('deja de estar esperando', r3.esperandoDesde === null);
  ok('NO SE SALTEA UN COBRO: la fecha no vuelve a avanzar',
     r3.nextRun === r2.nextRun, `${r2.nextRun} -> ${r3.nextRun}`);

  console.log('\n6. Topes por economía');
  const pc = (await pedir('/api/entities', { method: 'POST', body: JSON.stringify({
    name: 'PanaClaw', kind: 'negocio' }) })).datos.entity;
  const mes = new Date().toISOString().slice(0, 7);
  const g1 = await pedir('/api/budgets', { method: 'PUT', body: JSON.stringify({
    categoryId: null, entityId: null, amountMinor: 500000, period: mes }) });
  const g2 = await pedir('/api/budgets', { method: 'PUT', body: JSON.stringify({
    categoryId: null, entityId: pc.id, amountMinor: 200000, period: mes }) });
  ok('el tope de todas juntas se guarda', g1.status === 200, g1.status);
  ok('EL DE PANACLAW NO PISA AL OTRO', g2.status === 200, g2.status);

  snap = (await pedir('/api/snapshot')).datos;
  const globales = snap.budgets.filter((b) => b.period === mes && b.categoryId === null);
  ok('conviven los dos', globales.length === 2, globales.length);
  ok('cada uno con su economía',
     globales.some((b) => b.entityId === null) && globales.some((b) => b.entityId === pc.id),
     JSON.stringify(globales.map((b) => b.entityId)));

  console.log();
  if (fallos.length) { console.log(`FALLARON ${fallos.length}: ${fallos.join(', ')}`); process.exit(1); }
  console.log('Todo bien.');
}
main().catch((e) => { console.error(e); process.exit(1); });
