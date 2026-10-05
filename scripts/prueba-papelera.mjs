/**
 * Papelera y archivo, contra un Worker de verdad.
 *
 * Lo que se prueba es lo unico que importa: que vaciar la papelera NUNCA deje
 * un movimiento huerfano. Borrar una categoria que usan catorce movimientos
 * haria mentir al historial, y el historial es lo que no se puede romper.
 *
 *   npx wrangler dev --local --port 8856 &
 *   node scripts/prueba-papelera.mjs http://127.0.0.1:8856
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:8856';
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
  const email = `pap+${Date.now()}@ejemplo.test`;
  const alta = await pedir('/api/setup', { method: 'POST', body: JSON.stringify({
    email, password: await derivar('contraseña-larga', email), displayName: 'Abrinay',
    householdName: 'Casa', currency: 'USD', setupKey: 'clave-de-prueba' }) });
  if (alta.status !== 200) { console.log('MAL alta:', alta.status, JSON.stringify(alta.datos)); process.exit(1); }

  let snap = (await pedir('/api/snapshot')).datos;
  const familia = snap.entities[0].id;
  const cuenta = (await pedir('/api/accounts', { method: 'POST', body: JSON.stringify({
    name: 'Banco', category: 2, currency: 'USD', initialBalanceMinor: 0 }) })).datos.account;

  const crearCat = async (name) => (await pedir('/api/categories', { method: 'POST', body: JSON.stringify({
    name, type: 'gasto', entityId: familia }) })).datos.category;

  const suelta = await crearCat('Probando, se puede tirar');
  const usada = await crearCat('Con historia');

  await pedir('/api/transactions', { method: 'POST', body: JSON.stringify({
    type: 3, amountMinor: 5000, description: 'Un gasto', categoryId: usada.id,
    accountId: cuenta.id, date: Date.now() }) });

  console.log('1. Tirar a la papelera');
  let r = await pedir('/api/papelera', { method: 'POST', body: JSON.stringify({
    tipo: 'categoria', id: suelta.id, destino: 'papelera' }) });
  ok('acepta mandar a la papelera', r.status === 200, `${r.status} ${JSON.stringify(r.datos)}`);
  snap = (await pedir('/api/snapshot')).datos;
  let c = snap.categories.find((x) => x.id === suelta.id);
  ok('queda marcada con fecha y con quién', Boolean(c?.trashedAt) && Boolean(c?.trashedBy),
    JSON.stringify({ at: c?.trashedAt, by: c?.trashedBy }));
  ok('sigue existiendo, no se borró sola', c !== undefined);

  console.log('\n2. Una sola papelera: no hay archivo');
  r = await pedir('/api/papelera', { method: 'POST', body: JSON.stringify({
    tipo: 'categoria', id: usada.id }) });
  snap = (await pedir('/api/snapshot')).datos;
  c = snap.categories.find((x) => x.id === usada.id);
  ok('la que tiene historia tambien va a la papelera',
    Boolean(c?.trashedAt), JSON.stringify({ at: c?.trashedAt }));
  ok('y archived queda apagado: un solo cajon, no dos',
    c?.archived === false, JSON.stringify({ archived: c?.archived }));

  console.log('\n3. Qué se puede borrar y qué no, antes de tocar nada');
  r = await pedir('/api/papelera');
  const suelto = r.datos.items.find((i) => i.id === suelta.id);
  ok('la suelta no tiene ataduras', suelto?.motivo === null, JSON.stringify(suelto));

  console.log('\n4. VACIAR NO DEJA HUÉRFANOS');
  // Mandar tambien la usada a la papelera, a proposito.
  await pedir('/api/papelera', { method: 'POST', body: JSON.stringify({
    tipo: 'categoria', id: usada.id, destino: 'papelera' }) });
  const movsAntes = (await pedir('/api/snapshot')).datos.transactions.length;

  r = await pedir('/api/papelera/vaciar', { method: 'POST', body: JSON.stringify({}) });
  ok('vaciar responde 200', r.status === 200, `${r.status} ${JSON.stringify(r.datos)}`);
  ok('borró exactamente una: la que no tenía historia', r.datos.borrados === 1,
    `borrados=${r.datos.borrados}`);
  ok('RETUVO la que usan movimientos', r.datos.retenidos.length === 1,
    JSON.stringify(r.datos.retenidos));
  ok('y dice por qué', String(r.datos.retenidos[0]?.motivo).includes('movimiento'),
    JSON.stringify(r.datos.retenidos[0]));

  snap = (await pedir('/api/snapshot')).datos;
  ok('la suelta ya no está', !snap.categories.some((x) => x.id === suelta.id));
  ok('la usada SÍ sigue estando', snap.categories.some((x) => x.id === usada.id));
  ok('NINGÚN movimiento quedó huérfano', snap.transactions.length === movsAntes
    && snap.transactions.every((t) => !t.categoryId
      || snap.categories.some((x) => x.id === t.categoryId)),
    `movs ${snap.transactions.length} vs ${movsAntes}`);

  console.log('\n5. La cuenta regresiva');
  r = await pedir('/api/papelera');
  ok('dice el plazo', r.datos.diasHastaBorrar === 30, String(r.datos.diasHastaBorrar));
  const conHistoria = r.datos.items.find((i) => i.id === usada.id);
  ok('lo que tiene historia NO tiene cuenta regresiva',
    conHistoria?.diasQueQuedan === null, JSON.stringify(conHistoria));

  // Una suelta nueva, para mirarle los dias y para borrarla por seleccion.
  const paraContar = await crearCat('Para contar los dias');
  await pedir('/api/papelera', { method: 'POST', body: JSON.stringify({
    tipo: 'categoria', id: paraContar.id }) });
  r = await pedir('/api/papelera');
  const recien = r.datos.items.find((i) => i.id === paraContar.id);
  ok('recien tirada le quedan 30 dias', recien?.diasQueQuedan === 30,
    JSON.stringify(recien));

  console.log('\n6. Borrar varias de un saque');
  const a = await crearCat('Marcada A');
  const b2 = await crearCat('Marcada B');
  const sinMarcar = await crearCat('Sin marcar');
  for (const x of [a, b2, sinMarcar]) {
    await pedir('/api/papelera', { method: 'POST', body: JSON.stringify({
      tipo: 'categoria', id: x.id }) });
  }
  r = await pedir('/api/papelera/vaciar', { method: 'POST', body: JSON.stringify({
    items: [{ tipo: 'categoria', id: a.id }, { tipo: 'categoria', id: b2.id }] }) });
  ok('borra solo las marcadas', r.datos.borrados === 2, JSON.stringify(r.datos));
  snap = (await pedir('/api/snapshot')).datos;
  ok('la que no se marco sigue en la papelera',
    snap.categories.some((x) => x.id === sinMarcar.id));
  ok('las marcadas ya no estan',
    !snap.categories.some((x) => x.id === a.id || x.id === b2.id));

  r = await pedir('/api/papelera/vaciar', { method: 'POST', body: JSON.stringify({ items: [] }) });
  ok('una seleccion vacia se rechaza', r.status === 400, String(r.status));

  console.log('\n7. Restaurar');
  r = await pedir('/api/papelera/restaurar', { method: 'POST', body: JSON.stringify({
    tipo: 'categoria', id: usada.id }) });
  snap = (await pedir('/api/snapshot')).datos;
  c = snap.categories.find((x) => x.id === usada.id);
  ok('vuelve sin papelera', c?.trashedAt === null && c?.archived === false,
    JSON.stringify(c));

  console.log('\n8. Entradas inválidas');
  r = await pedir('/api/papelera', { method: 'POST', body: JSON.stringify({
    tipo: 'inventado', id: 'x', destino: 'papelera' }) });
  ok('rechaza un tipo que no existe', r.status === 400, String(r.status));
  r = await pedir('/api/papelera', { method: 'POST', body: JSON.stringify({
    tipo: 'categoria', id: 'no-existe', destino: 'papelera' }) });
  ok('404 si el id no existe', r.status === 404, String(r.status));
  cookie = '';
  r = await pedir('/api/papelera');
  ok('exige sesión', r.status === 401, String(r.status));

  console.log(fallos.length ? `\nHay ${fallos.length} fallo(s).\n` : '\nTodo bien.\n');
  process.exit(fallos.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
