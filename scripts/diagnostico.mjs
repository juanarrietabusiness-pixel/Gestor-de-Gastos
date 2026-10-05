/**
 * Diagnostico de la app publicada.
 *
 * Prueba endpoints elegidos para aislar donde falla, en vez de adivinar.
 * La clave esta en comparar rutas que hashean contraseña contra rutas que no:
 * si solo fallan las primeras, el problema es el limite de CPU del Worker.
 */

const URL_APP = process.env.URL_APP;
if (!URL_APP) { console.error('Falta URL_APP'); process.exit(1); }

async function probar(nombre, ruta, opciones, esperado) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${URL_APP}${ruta}`, { ...opciones, signal: AbortSignal.timeout(30_000) });
    const ms = Date.now() - t0;
    const cuerpo = (await res.text()).slice(0, 160);
    const ok = res.status === esperado;
    console.log(`${ok ? 'OK  ' : 'MAL '} ${nombre}`);
    console.log(`       HTTP ${res.status} (esperado ${esperado}) · ${ms} ms`);
    console.log(`       ${cuerpo}`);
    return { ok, status: res.status, ms };
  } catch (e) {
    console.log(`MAL  ${nombre}`);
    console.log(`       excepcion: ${e.message} · ${Date.now() - t0} ms`);
    return { ok: false, status: 0, ms: Date.now() - t0 };
  }
}

const json = (obj) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
});

console.log(`Diagnosticando ${URL_APP}\n`);

console.log('--- Rutas que NO hashean contraseña (control) ---');
const status = await probar('GET /api/status', '/api/status', {}, 200);
const sinSesion = await probar('GET /api/snapshot sin sesion', '/api/snapshot', {}, 401);
const claveMala = await probar(
  'POST /api/setup con clave incorrecta (corta antes de hashear)',
  '/api/setup',
  json({ setupKey: 'incorrecta-a-proposito', email: 'x@y.com', password: 'contrasena123', displayName: 'X' }),
  403,
);

console.log('\n--- Rutas que SI hashean contraseña ---');
const loginFantasma = await probar(
  'POST /api/login con email inexistente (hashea igual, contra timing)',
  '/api/login',
  json({ email: 'no-existe-jamas@ejemplo.test', password: 'loquesea123' }),
  401,
);

console.log('\n══════════════ VEREDICTO ══════════════');
const controlOk = status.ok && sinSesion.ok && claveMala.ok;

if (controlOk && loginFantasma.status === 500) {
  console.log('CONFIRMADO: el limite de CPU del Worker.');
  console.log('Las rutas sin hasheo responden bien; la que hashea devuelve 500.');
  console.log('PBKDF2 con 210.000 iteraciones cuesta ~156 ms de CPU y el plan');
  console.log('gratuito permite 10 ms por peticion.');
} else if (controlOk && loginFantasma.ok) {
  console.log('El hasheo funciona: el limite de CPU NO es el problema.');
  console.log('Hay que buscar la falla de /api/setup en otro lado (el batch de D1).');
} else if (!controlOk) {
  console.log('Falla algo mas basico que el hasheo. Revisar el control de arriba.');
} else {
  console.log(`Resultado inesperado en login: HTTP ${loginFantasma.status}`);
}
console.log('═══════════════════════════════════════');
