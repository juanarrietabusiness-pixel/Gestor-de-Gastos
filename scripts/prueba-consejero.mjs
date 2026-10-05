/**
 * El consejero, de punta a punta, contra un Claude de mentira.
 *
 * No hace falta una clave de verdad ni gastar un centavo: se levanta un
 * servidor que habla el protocolo de la API (SSE) y se comprueba lo unico que
 * escribimos nosotros —que es donde pueden estar los errores—:
 *
 *   - que la ruta pida sesion,
 *   - que sin clave avise en vez de romperse,
 *   - QUE LOS NUMEROS QUE VIAJAN COMO CONTEXTO SEAN LOS DE ESTE HOGAR,
 *   - que el contexto vaya marcado para cache, que es lo que abarata cada turno,
 *   - que el texto llegue al navegador a medida que se genera,
 *   - y que la herramienta de detalle se ejecute contra la base y su resultado
 *     vuelva a Claude.
 *
 *   node scripts/prueba-consejero.mjs http://127.0.0.1:8860
 */

import { createServer } from 'node:http';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8860';
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
  try { return { status: res.status, datos: t ? JSON.parse(t) : null, texto: t }; }
  catch { return { status: res.status, datos: null, texto: t }; }
}
async function derivar(password, email) {
  const enc = new TextEncoder();
  const m = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const b = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('gg:v1:' + email.trim().toLowerCase()),
    iterations: 210_000, hash: 'SHA-256' }, m, 256);
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Un evento SSE con la forma que manda la API. */
const sse = (tipo, dato) => `event: ${tipo}\ndata: ${JSON.stringify(dato)}\n\n`;

/** Claude de mentira: guarda lo que recibe y contesta lo que se le diga. */
function claudeDeMentira(guion) {
  const recibido = [];
  let vuelta = 0;
  const servidor = createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      recibido.push(JSON.parse(cuerpo));
      const acto = guion[Math.min(vuelta, guion.length - 1)];
      vuelta += 1;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const e of acto) res.write(e);
      res.end();
    });
  });
  return { servidor, recibido };
}

/** Guion: responde con texto y termina. */
const actoTexto = (texto) => [
  sse('message_start', { type: 'message_start', message: {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5',
    content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 0 } } }),
  sse('content_block_start', { type: 'content_block_start', index: 0,
    content_block: { type: 'text', text: '' } }),
  ...texto.split(' ').map((p, i) => sse('content_block_delta', {
    type: 'content_block_delta', index: 0,
    delta: { type: 'text_delta', text: i === 0 ? p : ` ${p}` } })),
  sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
  sse('message_delta', { type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 5 } }),
  sse('message_stop', { type: 'message_stop' }),
];

/** Guion: pide la herramienta y corta. */
const actoHerramienta = (args) => [
  sse('message_start', { type: 'message_start', message: {
    id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-opus-5',
    content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 0 } } }),
  sse('content_block_start', { type: 'content_block_start', index: 0,
    content_block: { type: 'tool_use', id: 'toolu_1', name: 'buscar_movimientos', input: {} } }),
  sse('content_block_delta', { type: 'content_block_delta', index: 0,
    delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } }),
  sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
  sse('message_delta', { type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } }),
  sse('message_stop', { type: 'message_stop' }),
];

async function main() {
  console.log(`\nProbando contra ${BASE}\n`);

  console.log('1. Sin sesión');
  const anon = await fetch(`${BASE}/api/consejo`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensajes: [] }) });
  ok('exige sesión', anon.status === 401, anon.status);

  const email = `cons+${Date.now()}@ejemplo.test`;
  const alta = await pedir('/api/setup', { method: 'POST', body: JSON.stringify({
    email, password: await derivar('contraseña-larga', email), displayName: 'Abrinay',
    householdName: 'Casa', currency: 'USD', setupKey: 'clave-de-prueba' }) });
  if (alta.status !== 200) { console.log('MAL alta:', alta.status, alta.texto); process.exit(1); }

  const snap0 = (await pedir('/api/snapshot')).datos;
  const cuenta = (await pedir('/api/accounts', { method: 'POST', body: JSON.stringify({
    name: 'BG principal', category: 2, currency: 'USD', initialBalanceMinor: 0 }) })).datos.account;
  const cat = (await pedir('/api/categories', { method: 'POST', body: JSON.stringify({
    name: 'Video musical', type: 'gasto', entityId: snap0.entities[0].id }) })).datos.category;
  await pedir('/api/transactions', { method: 'POST', body: JSON.stringify({
    type: 3, amountMinor: 55924, accountId: cuenta.id, categoryId: cat.id,
    date: Date.now(), description: 'Sebastián · camarógrafo' }) });

  console.log('\n2. Estado');
  const est = await pedir('/api/consejo/estado');
  ok('dice si está disponible', est.status === 200 && typeof est.datos.disponible === 'boolean',
     JSON.stringify(est.datos));

  console.log('\n3. UNA PREGUNTA DE VERDAD, CONTRA UN CLAUDE DE MENTIRA');
  const { servidor, recibido } = claudeDeMentira([
    actoHerramienta({ categoria: 'Video musical' }),
    actoTexto('Gastaste 559.24 en Video musical. Es el 100% del mes.'),
  ]);
  await new Promise((r) => servidor.listen(8861, r));

  const res = await fetch(`${BASE}/api/consejo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ mensajes: [{ rol: 'yo', texto: '¿En qué se fue la plata?' }] }),
  });
  ok('responde 200', res.status === 200, res.status);
  ok('en texto plano y en vivo',
     (res.headers.get('content-type') ?? '').includes('text/plain'),
     res.headers.get('content-type'));

  const respuesta = await res.text();
  ok('el texto llega al navegador', respuesta.includes('559.24'), respuesta.slice(0, 120));
  servidor.close();

  console.log('\n4. Lo que se le manda a Claude');
  ok('hubo dos vueltas: pidió detalle y después respondió', recibido.length === 2, recibido.length);

  const p1 = recibido[0];
  ok('el modelo es Opus 5', p1.model === 'claude-opus-5', p1.model);
  ok('lleva la herramienta de detalle',
     p1.tools?.[0]?.name === 'buscar_movimientos', JSON.stringify(p1.tools?.[0]?.name));

  const contexto = p1.system?.[1];
  ok('EL CONTEXTO SON LOS NÚMEROS DE ESTE HOGAR',
     typeof contexto?.text === 'string' && contexto.text.includes('55924'),
     (contexto?.text ?? '').slice(0, 100));
  ok('y va marcado para cache, que es lo que abarata cada turno',
     contexto?.cache_control?.type === 'ephemeral', JSON.stringify(contexto?.cache_control));
  ok('las instrucciones van primero y aparte',
     typeof p1.system?.[0]?.text === 'string' && p1.system[0].text.includes('consejero'));

  const p2 = recibido[1];
  const resultado = p2.messages?.[2]?.content?.[0];
  ok('LA HERRAMIENTA CORRIÓ CONTRA LA BASE Y VOLVIÓ',
     resultado?.type === 'tool_result' && String(resultado.content).includes('Sebastián'),
     JSON.stringify(resultado).slice(0, 160));
  ok('con el monto real, en centavos',
     String(resultado?.content ?? '').includes('55924'),
     String(resultado?.content ?? '').slice(0, 120));

  console.log('\n5. Entradas inválidas');
  const vacio = await pedir('/api/consejo', { method: 'POST', body: JSON.stringify({ mensajes: [] }) });
  ok('rechaza sin pregunta', vacio.status === 400, vacio.status);
  const larga = await pedir('/api/consejo', { method: 'POST', body: JSON.stringify({
    mensajes: Array.from({ length: 50 }, () => ({ rol: 'yo', texto: 'hola' })) }) });
  ok('corta una conversación interminable', larga.status === 400, larga.status);

  console.log();
  if (fallos.length) { console.log(`FALLARON ${fallos.length}: ${fallos.join(', ')}`); process.exit(1); }
  console.log('Todo bien.');
}
main().catch((e) => { console.error(e); process.exit(1); });
