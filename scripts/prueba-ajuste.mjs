/**
 * Prueba del saldo editable y de la quincenal, contra un Worker de verdad.
 *
 * Ni el typecheck ni los tests del nucleo pueden ver lo que importa aca: que
 * la resta la haga bien SQL contra el saldo del momento, que los movimientos
 * queden intactos, y que despues del ajuste los movimientos nuevos sigan
 * moviendo el numero. Todo eso solo se ve ejecutando.
 *
 *   npx wrangler dev --local --port 8799 &
 *   node scripts/prueba-ajuste.mjs http://127.0.0.1:8799
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:8799';
const CLAVE = process.env.SETUP_KEY ?? 'clave-de-prueba';

let cookie = '';
const fallos = [];

function ok(nombre, condicion, detalle = '') {
  console.log(`  ${condicion ? 'OK  ' : 'MAL '} ${nombre}${condicion ? '' : `  -> ${detalle}`}`);
  if (!condicion) fallos.push(nombre);
}

async function pedir(ruta, opciones = {}) {
  const res = await fetch(BASE + ruta, {
    ...opciones,
    headers: {
      ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const guardada = res.headers.get('set-cookie');
  if (guardada) cookie = guardada.split(';')[0];
  const texto = await res.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
  return { status: res.status, datos };
}

/** Misma derivacion que el navegador (shared/kdf.ts). */
async function derivar(password, email) {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode('gg:v1:' + email.trim().toLowerCase()), iterations: 210_000, hash: 'SHA-256' },
    material, 256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const saldoDe = (cuentas, id) => cuentas.find((c) => c.id === id).balanceMinor;

async function main() {
  console.log(`\nProbando contra ${BASE}\n`);

  const email = `prueba+${Date.now()}@ejemplo.test`;
  console.log('1. Alta del hogar');
  const alta = await pedir('/api/setup', {
    method: 'POST',
    body: JSON.stringify({
      email, password: await derivar('contraseña-larga', email),
      displayName: 'Ana', householdName: 'Prueba', currency: 'USD', setupKey: CLAVE,
    }),
  });
  ok('se crea el hogar', alta.status === 200, `${alta.status} ${JSON.stringify(alta.datos)}`);
  if (alta.status !== 200) { console.log('\nSin hogar no se puede seguir.'); process.exit(1); }

  console.log('\n2. Una cuenta con saldo inicial y dos movimientos');
  const cuenta = await pedir('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ name: 'Banco', category: 2, currency: 'USD', initialBalanceMinor: 100_000 }),
  });
  const cuentaId = cuenta.datos.account.id;
  ok('saldo inicial 1000.00', cuenta.datos.account.balanceMinor === 100_000, cuenta.datos.account.balanceMinor);

  await pedir('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ type: 2, amountMinor: 50_000, accountId: cuentaId, date: Date.now(), description: 'Sueldo' }),
  });
  const tras = await pedir('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ type: 3, amountMinor: 7_500, accountId: cuentaId, date: Date.now(), description: 'Super' }),
  });
  ok('los movimientos dejan el saldo en 1425.00', saldoDe(tras.datos.accounts, cuentaId) === 142_500,
     saldoDe(tras.datos.accounts, cuentaId));

  console.log('\n3. El ajuste manual');
  const antes = await pedir('/api/snapshot');
  const movsAntes = antes.datos.transactions.map((t) => `${t.id}:${t.amountMinor}:${t.type}`).sort();

  const ajuste = await pedir('/api/adjustments', {
    method: 'POST',
    body: JSON.stringify({ accountId: cuentaId, balanceMinor: 140_000, note: 'faltaba plata' }),
  });
  ok('responde bien', ajuste.status === 201, `${ajuste.status} ${JSON.stringify(ajuste.datos)}`);
  ok('el saldo queda EXACTAMENTE en lo pedido', ajuste.datos?.account?.balanceMinor === 140_000,
     ajuste.datos?.account?.balanceMinor);
  ok('la diferencia guardada es -25.00', ajuste.datos?.adjustment?.deltaMinor === -2_500,
     ajuste.datos?.adjustment?.deltaMinor);
  ok('guarda de cuanto a cuanto',
     ajuste.datos?.adjustment?.fromMinor === 142_500 && ajuste.datos?.adjustment?.toMinor === 140_000,
     JSON.stringify(ajuste.datos?.adjustment));

  const despues = await pedir('/api/snapshot');
  const movsDespues = despues.datos.transactions.map((t) => `${t.id}:${t.amountMinor}:${t.type}`).sort();
  ok('NINGUN movimiento cambio', JSON.stringify(movsAntes) === JSON.stringify(movsDespues),
     `${movsAntes.length} -> ${movsDespues.length}`);
  ok('no aparecio ningun movimiento nuevo', movsDespues.length === movsAntes.length, movsDespues.length);
  ok('el snapshot tambien muestra el saldo ajustado',
     saldoDe(despues.datos.accounts, cuentaId) === 140_000, saldoDe(despues.datos.accounts, cuentaId));

  console.log('\n4. Lo importante: los movimientos siguen alterando el saldo ajustado');
  const nuevo = await pedir('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ type: 3, amountMinor: 10_000, accountId: cuentaId, date: Date.now(), description: 'Nafta' }),
  });
  ok('un gasto de 100.00 deja el saldo en 1300.00', saldoDe(nuevo.datos.accounts, cuentaId) === 130_000,
     saldoDe(nuevo.datos.accounts, cuentaId));

  console.log('\n5. Casos de borde del ajuste');
  const cero = await pedir('/api/adjustments', {
    method: 'POST', body: JSON.stringify({ accountId: cuentaId, balanceMinor: 130_000 }),
  });
  ok('ajustar al mismo valor no guarda nada', cero.datos?.adjustment === null, JSON.stringify(cero.datos?.adjustment));

  const negativo = await pedir('/api/adjustments', {
    method: 'POST', body: JSON.stringify({ accountId: cuentaId, balanceMinor: -5_000 }),
  });
  ok('acepta saldo negativo', negativo.datos?.account?.balanceMinor === -5_000, negativo.datos?.account?.balanceMinor);

  const inexistente = await pedir('/api/adjustments', {
    method: 'POST', body: JSON.stringify({ accountId: 'no-existe', balanceMinor: 1 }),
  });
  ok('rechaza una cuenta que no existe', inexistente.status === 404, inexistente.status);

  const historial = await pedir(`/api/adjustments?account=${cuentaId}`);
  ok('el historial trae los dos ajustes', historial.datos?.adjustments?.length === 2,
     historial.datos?.adjustments?.length);
  ok('el mas reciente va primero',
     historial.datos?.adjustments?.[0]?.toMinor === -5_000, JSON.stringify(historial.datos?.adjustments?.[0]));

  console.log('\n6. El ajuste con una transferencia recibida en el medio');
  // Es el caso que la copia mal escrita del SQL habria arruinado: la pata de
  // entrada de una transferencia sin monto de destino propio.
  const otra = await pedir('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ name: 'Efectivo', category: 1, currency: 'USD', initialBalanceMinor: 20_000 }),
  });
  const otraId = otra.datos.account.id;
  const transfer = await pedir('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({
      type: 4, amountMinor: 5_000, accountId: otraId, destAccountId: cuentaId,
      date: Date.now(), description: 'Paso plata',
    }),
  });
  ok('la transferencia entra en la cuenta destino', saldoDe(transfer.datos.accounts, cuentaId) === 0,
     saldoDe(transfer.datos.accounts, cuentaId));

  const conTransfer = await pedir('/api/adjustments', {
    method: 'POST', body: JSON.stringify({ accountId: cuentaId, balanceMinor: 99_900 }),
  });
  ok('el ajuste sigue siendo exacto con una transferencia recibida',
     conTransfer.datos?.account?.balanceMinor === 99_900, conTransfer.datos?.account?.balanceMinor);

  console.log('\n7. Pago habitual quincenal');
  const quincenal = await pedir('/api/recurring', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Sueldo', type: 2, amountMinor: 300_000, accountId: cuentaId,
      frequency: 'quincenal', dayOfMonth: 15, dayOfMonth2: 31,
      startAt: new Date(2026, 0, 1, 12).getTime(),
    }),
  });
  ok('se guarda', quincenal.status === 201, `${quincenal.status} ${JSON.stringify(quincenal.datos)}`);
  const r = quincenal.datos?.recurring;
  ok('guarda los dos dias', r?.dayOfMonth === 15 && r?.dayOfMonth2 === 31, JSON.stringify(r));
  ok('el primer cobro es el 15 de enero',
     r && new Date(r.nextRun).toISOString().slice(0, 10) === '2026-01-15',
     r && new Date(r.nextRun).toISOString());

  const repetido = await pedir('/api/recurring', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Mal', type: 2, amountMinor: 1000, accountId: cuentaId,
      frequency: 'quincenal', dayOfMonth: 15, dayOfMonth2: 15,
    }),
  });
  ok('rechaza los dos cobros el mismo dia', repetido.status === 400, repetido.status);

  console.log();
  if (fallos.length) {
    console.log(`FALLARON ${fallos.length}: ${fallos.join(', ')}`);
    process.exit(1);
  }
  console.log('Todo bien.');
}

main().catch((e) => { console.error(e); process.exit(1); });
