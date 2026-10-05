/**
 * Punto de entrada del Worker.
 *
 * Un solo Worker sirve la API, el WebSocket de tiempo real y el frontend
 * compilado. No hay servidor que mantener ni que pagar cuando nadie lo usa, y
 * corre en el borde de Cloudflare, asi que responde cerca de donde este cada
 * uno.
 */

import { sesionActual, type Sesion } from './auth.ts';
import type { Env } from './env.ts';
import { ErrorValidacion, error, json } from './http.ts';
import * as auth from './routes/auth.ts';
import * as data from './routes/data.ts';
import * as adjustments from './routes/adjustments.ts';
import * as entities from './routes/entities.ts';
import * as papelera from './routes/papelera.ts';
import * as resumen from './routes/resumen.ts';
import * as consejo from './routes/consejo.ts';
import * as jarTransfers from './routes/jarTransfers.ts';
import * as recurring from './routes/recurring.ts';
import * as tx from './routes/transactions.ts';
import { correrPagosHabituales } from './cron.ts';
import { barrerPapelera } from './papelera-vieja.ts';

export { HouseholdHub } from './hub.ts';

type Handler = (req: Request, env: Env, sesion: Sesion) => Promise<Response>;
type HandlerConId = (req: Request, env: Env, sesion: Sesion, id: string) => Promise<Response>;

/** Rutas sin parametros en el camino. */
const RUTAS: Record<string, Partial<Record<string, Handler>>> = {
  '/api/me': { GET: async (_r, _e, s) => json({ me: s }) },
  '/api/snapshot': { GET: data.traerTodo },
  '/api/invite': { POST: auth.invitar },
  '/api/password': { POST: auth.cambiarPassword },
  '/api/accounts': { GET: data.listarCuentasRuta, POST: data.crearCuenta },
  '/api/categories': { GET: data.listarCategoriasRuta, POST: data.crearCategoria },
  '/api/jars': { GET: data.listarJarrasRuta, PUT: data.guardarJarras },
  '/api/budgets': { GET: data.listarPresupuestosRuta, PUT: data.guardarPresupuesto },
  '/api/transactions': { GET: tx.listar, POST: tx.crear },
  '/api/transactions/batch': { POST: tx.crearLote },
  '/api/profile': { PUT: data.editarPerfil },
  '/api/recurring': { GET: recurring.listar, POST: recurring.crear },
  '/api/adjustments': { GET: adjustments.listar, POST: adjustments.crear },
  '/api/jar-transfers': { GET: jarTransfers.listar, POST: jarTransfers.crear },
  '/api/jars/poner-al-dia': { POST: jarTransfers.ponerAlDia },
  // Repartir en jarras plata que ya estaba en las cuentas (los saldos
  // iniciales, sobre todo). Ver jarTransfers.ts.
  '/api/jars/asignar': { POST: jarTransfers.asignar },
  // Un negocio le paga a la casa: sale de una jarra suya y entra repartido.
  '/api/jar-transfers/pago': { POST: jarTransfers.pagar },
  '/api/entities': { GET: entities.listar, POST: entities.crear },
  // Los numeros ya calculados, para auditar sin leer el codigo. Ver resumen.ts.
  '/api/resumen': { GET: resumen.traer },
  // Papelera y archivo. Ver worker/routes/papelera.ts.
  '/api/papelera': { GET: papelera.revisar, POST: papelera.descartar },
  '/api/papelera/restaurar': { POST: papelera.restaurar },
  '/api/papelera/vaciar': { POST: papelera.vaciar },
  // El consejero. La respuesta va en streaming; ver consejo.ts.
  '/api/consejo': { POST: consejo.preguntar },
  '/api/consejo/estado': { GET: consejo.estado },
};

/** Rutas con un id al final: /api/algo/:id */
const RUTAS_CON_ID: { prefijo: string; metodos: Partial<Record<string, HandlerConId>> }[] = [
  { prefijo: '/api/transactions/', metodos: { PUT: tx.editar, DELETE: tx.borrar } },
  { prefijo: '/api/accounts/', metodos: { PUT: data.editarCuenta, DELETE: data.borrarCuenta } },
  { prefijo: '/api/categories/', metodos: { PUT: data.editarCategoria } },
  { prefijo: '/api/budgets/', metodos: { DELETE: data.borrarPresupuesto } },
  // "Ya me pagaron" / "todavia no me pagaron". Ver recurring.ts.
  // Van ANTES de '/api/recurring/': el router toma el primer prefijo que
  // coincide, y con el generico primero el id quedaria en "cobrar/xyz".
  { prefijo: '/api/recurring/cobrar/', metodos: { POST: recurring.cobrar } },
  { prefijo: '/api/recurring/deshacer/', metodos: { POST: recurring.deshacerCobro } },
  { prefijo: '/api/recurring/', metodos: { PUT: recurring.editar, DELETE: recurring.borrar } },
  { prefijo: '/api/jar-aportes/', metodos: { DELETE: jarTransfers.borrarAporte } },
  { prefijo: '/api/jar-transfers/', metodos: { DELETE: jarTransfers.borrar } },
  { prefijo: '/api/entities/', metodos: { PUT: entities.editar, DELETE: entities.borrar } },
];

export default {
  /**
   * Disparador programado: carga los pagos habituales que vencieron.
   *
   * Corre una vez por dia (ver [triggers] en wrangler.toml). No depende de que
   * alguien abra la app, y es idempotente: si corre dos veces el mismo dia, la
   * segunda no encuentra nada vencido.
   */
  async scheduled(_evento: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      correrPagosHabituales(env)
        .then(({ creados, hogares }) => {
          if (creados > 0) {
            console.log(`Pagos habituales: ${creados} movimiento(s) en ${hogares.length} hogar(es)`);
          }
        })
        .catch((e) => console.error('Fallo el disparador de pagos habituales', e)),
    );

    // Y de paso se lleva lo que lleva 30 dias en la papelera. Va aparte para
    // que si uno falla el otro corra igual.
    ctx.waitUntil(
      barrerPapelera(env)
        .then(({ borrados }) => {
          if (borrados > 0) console.log(`Papelera: ${borrados} cosa(s) borrada(s)`);
        })
        .catch((e) => console.error('Fallo el barrido de la papelera', e)),
    );
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Todo lo que no sea /api lo sirve el frontend compilado.
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(req);
    }

    try {
      return await manejarApi(req, env, url);
    } catch (e) {
      if (e instanceof ErrorValidacion) return error(e.message, 400);
      console.error('Error no controlado', e);
      return error('Algo salió mal de nuestro lado', 500);
    }
  },
};

async function manejarApi(req: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  const metodo = req.method.toUpperCase();

  // --- publicas --------------------------------------------------------
  if (pathname === '/api/status' && metodo === 'GET') return auth.estado(req, env);
  if (pathname === '/api/setup' && metodo === 'POST') return auth.setup(req, env);
  if (pathname === '/api/login' && metodo === 'POST') return auth.login(req, env);
  if (pathname === '/api/logout' && metodo === 'POST') return auth.logout(req, env);

  // --- de aca en adelante hace falta sesion -----------------------------
  const sesion = await sesionActual(req, env);
  if (!sesion) return error('Necesitas iniciar sesión', 401);

  // Conexion de tiempo real. Se valida la sesion aca y recien despues se
  // entrega al Durable Object del hogar, que es el unico que ve a ambos.
  if (pathname === '/api/live') {
    if (req.headers.get('Upgrade') !== 'websocket') {
      return error('Se esperaba una conexión WebSocket', 426);
    }

    const hub = env.HUB.get(env.HUB.idFromName(sesion.householdId));
    const destino = new URL('https://hub/connect');
    destino.searchParams.set('memberId', sesion.memberId);
    destino.searchParams.set('displayName', sesion.displayName);

    return hub.fetch(new Request(destino, req));
  }

  const exacta = RUTAS[pathname];
  if (exacta) {
    const handler = exacta[metodo];
    if (!handler) return error(`Método ${metodo} no permitido acá`, 405);
    return handler(req, env, sesion);
  }

  for (const { prefijo, metodos } of RUTAS_CON_ID) {
    if (!pathname.startsWith(prefijo)) continue;

    const id = decodeURIComponent(pathname.slice(prefijo.length));
    // Un id no lleva barras. Si las tiene, este no es el prefijo correcto:
    // se sigue buscando, porque puede haber uno mas largo mas abajo.
    if (!id || id.includes('/')) continue;

    const handler = metodos[metodo];
    if (!handler) return error(`Método ${metodo} no permitido acá`, 405);
    return handler(req, env, sesion, id);
  }

  return error('Ruta no encontrada', 404);
}
