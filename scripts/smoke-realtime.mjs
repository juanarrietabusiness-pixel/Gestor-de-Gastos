/**
 * Prueba de humo del tiempo real, contra el Cloudflare de produccion.
 *
 * En local los Durable Objects estan simulados por wrangler. Que el WebSocket
 * funcione ahi no demuestra que funcione de verdad: la hibernacion, el
 * enrutado a una unica instancia global y el upgrade de protocolo detras del
 * borde solo existen en produccion. Esta prueba los ejercita de verdad.
 *
 * Que hace:
 *   1. Siembra en D1 un hogar de prueba con dos personas y sus sesiones.
 *   2. Abre dos WebSockets, uno por persona, como si fueran dos telefonos.
 *   3. Una carga un gasto por HTTP, sin tocar su WebSocket.
 *   4. Comprueba que a la OTRA le llega el evento sola.
 *   5. Borra todo lo sembrado, pase lo que pase.
 *
 * El hogar de prueba usa ids con prefijo __smoke__ y se borra al final. El
 * borrado en cascada se lleva personas, cuentas y movimientos.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const URL_APP = process.env.URL_APP;
const BASE = 'gastos-db';
// --remote en CI; --local permite validar el script antes de mandarlo.
const ALCANCE = process.env.D1_ALCANCE ?? '--remote';

if (!URL_APP) {
  console.error('Falta URL_APP');
  process.exit(1);
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('hex');

const HOGAR = `__smoke__${randomUUID().slice(0, 8)}`;
const ANA = `${HOGAR}__ana`;
const BETO = `${HOGAR}__beto`;
const CUENTA = `${HOGAR}__cta`;
const tokenAna = token();
const tokenBeto = token();

/** Ejecuta SQL contra la base remota via wrangler. */
function sql(texto, etiqueta) {
  const archivo = `/tmp/smoke-${randomUUID()}.sql`;
  writeFileSync(archivo, texto);
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', BASE, ALCANCE, `--file=${archivo}`, '-y'], {
      stdio: 'pipe', encoding: 'utf8',
    });
    console.log(`  ${etiqueta}: ok`);
  } finally {
    try { unlinkSync(archivo); } catch {}
  }
}

function sembrar() {
  const t = Date.now();
  const vence = t + 3_600_000;
  sql(`
    INSERT INTO household (id, name, currency, created_at)
      VALUES ('${HOGAR}', 'Prueba de humo', 'USD', ${t});
    INSERT INTO member (id, household_id, email, password_hash, password_salt, iterations, display_name, color, created_at)
      VALUES ('${ANA}',  '${HOGAR}', '${ANA}@smoke.test',  'x', 'x', 1, 'Ana',  '#10b981', ${t}),
             ('${BETO}', '${HOGAR}', '${BETO}@smoke.test', 'x', 'x', 1, 'Beto', '#6366f1', ${t});
    INSERT INTO session (token_hash, member_id, created_at, expires_at, user_agent)
      VALUES ('${sha256(tokenAna)}',  '${ANA}',  ${t}, ${vence}, 'smoke'),
             ('${sha256(tokenBeto)}', '${BETO}', ${t}, ${vence}, 'smoke');
    INSERT INTO account (id, household_id, name, category, currency, initial_balance_minor, color, icon, owner, archived, display_order, created_at, updated_at)
      VALUES ('${CUENTA}', '${HOGAR}', 'Caja', 1, 'USD', 100000, '#000000', 'wallet', 'compartida', 0, 0, ${t}, ${t});
  `, 'sembrar datos de prueba');
}

function limpiar() {
  // El borrado en cascada se lleva personas, sesiones, cuentas y movimientos.
  sql(`DELETE FROM household WHERE id = '${HOGAR}';`, 'borrar datos de prueba');
}

/** Abre un WebSocket autenticado y espera a que el servidor salude. */
function conectar(nombre, tk) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${URL_APP.replace(/^http/, 'ws')}/api/live`, {
      headers: { Cookie: `gg_session=${tk}` },
    });
    const recibidos = [];
    const plazo = setTimeout(() => reject(new Error(`${nombre}: no llego el saludo`)), 20_000);

    ws.addEventListener('message', (ev) => {
      if (ev.data === 'pong') return;
      const e = JSON.parse(ev.data);
      recibidos.push(e);
      if (e.kind === 'hello') {
        clearTimeout(plazo);
        console.log(`  ${nombre}: conectado`);
        resolve({ ws, recibidos });
      }
    });
    ws.addEventListener('error', (e) => {
      clearTimeout(plazo);
      reject(new Error(`${nombre}: ${e.message ?? 'error de WebSocket'}`));
    });
  });
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let fallo = null;

  console.log('1. Sembrando hogar de prueba...');
  sembrar();

  let conexiones = [];
  try {
    console.log('\n2. Conectando los dos "telefonos"...');
    const ana = await conectar('Ana', tokenAna);
    const beto = await conectar('Beto', tokenBeto);
    conexiones = [ana.ws, beto.ws];

    // Le da un instante al Durable Object para registrar a los dos.
    await esperar(500);

    console.log('\n3. Ana carga un gasto por HTTP (sin tocar su WebSocket)...');
    const res = await fetch(`${URL_APP}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `gg_session=${tokenAna}` },
      body: JSON.stringify({
        type: 3, amountMinor: 12345, accountId: CUENTA, destAccountId: null,
        destAmountMinor: null, categoryId: null, jarId: null,
        distributeToJars: false, description: 'Prueba de tiempo real',
        notes: null, date: Date.now(),
      }),
    });

    if (!res.ok) throw new Error(`El alta fallo: HTTP ${res.status} ${await res.text()}`);
    const { transaction } = await res.json();
    console.log(`  guardado: ${transaction.id.slice(0, 8)}`);

    console.log('\n4. Esperando a que le llegue a Beto...');
    const inicio = Date.now();
    let llego = null;
    while (Date.now() - inicio < 15_000) {
      llego = beto.recibidos.find((e) => e.kind === 'tx:upsert' && e.tx.id === transaction.id);
      if (llego) break;
      await esperar(200);
    }

    if (!llego) throw new Error('NO le llego a Beto: el tiempo real no funciona en produccion');

    const demora = Date.now() - inicio;
    console.log(`  LLEGO en ${demora} ms: "${llego.tx.description}" $${(llego.tx.amountMinor / 100).toFixed(2)}`);

    // Ana tambien tiene que recibirlo. No es redundante: es lo que hace que,
    // si tiene la app abierta en el celular y en la compu, las dos se
    // actualicen. Reaplicar el mismo dato por id no cambia nada en pantalla.
    const ecoEnAna = ana.recibidos.some((e) => e.kind === 'tx:upsert' && e.tx.id === transaction.id);
    if (!ecoEnAna) throw new Error('El evento no volvio a Ana: se romperia el multi-dispositivo');
    console.log('  tambien le vuelve a Ana (multi-dispositivo): correcto');

    console.log('\n5. Ana lo borra...');
    const del = await fetch(`${URL_APP}/api/transactions/${transaction.id}`, {
      method: 'DELETE', headers: { Cookie: `gg_session=${tokenAna}` },
    });
    if (!del.ok) throw new Error(`El borrado fallo: HTTP ${del.status}`);

    const inicioBaja = Date.now();
    let baja = null;
    while (Date.now() - inicioBaja < 15_000) {
      baja = beto.recibidos.find((e) => e.kind === 'tx:delete' && e.id === transaction.id);
      if (baja) break;
      await esperar(200);
    }
    if (!baja) throw new Error('NO le llego la baja a Beto');
    console.log(`  la baja LLEGO en ${Date.now() - inicioBaja} ms`);

    console.log('\n6. Comprobando presencia...');
    const presencia = beto.recibidos.filter((e) => e.kind === 'hello' || e.kind === 'presence').at(-1);
    console.log(`  en linea segun el servidor: ${presencia?.online?.length ?? 0} persona(s)`);

    console.log('\n══════════════════════════════════════════');
    console.log(' TIEMPO REAL CONFIRMADO EN PRODUCCION');
    console.log('══════════════════════════════════════════');
  } catch (e) {
    fallo = e;
    console.error(`\nFALLO: ${e.message}`);
  } finally {
    for (const ws of conexiones) { try { ws.close(); } catch {} }
    console.log('\n7. Limpiando...');
    try { limpiar(); } catch (e) { console.error(`  no se pudo limpiar: ${e.message}`); }
  }

  process.exit(fallo ? 1 : 0);
}

main();
