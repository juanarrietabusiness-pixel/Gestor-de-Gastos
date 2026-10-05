/**
 * Alta del hogar, ingreso y salida.
 *
 * No hay registro publico: el hogar se crea una sola vez con SETUP_KEY y a la
 * segunda persona la invita la primera. Son dos y nada mas que dos.
 */

import {
  cerrarSesion, cookieDeSesion, cookieVacia, crearSesion, hashearPassword,
  limpiarSesiones, verificarPassword, type Sesion,
} from '../auth.ts';
import { aMember } from '../db.ts';
import type { Env } from '../env.ts';
import { ahora, claveDerivada, color, cuerpo, email, error, json, nuevoId, texto } from '../http.ts';
import { CATEGORIAS_INICIALES, JARRAS_INICIALES } from '../seed.ts';

const esHttps = (req: Request): boolean => new URL(req.url).protocol === 'https:';

/**
 * Crea el hogar y la primera persona. Solo funciona si todavia no existe
 * ningun hogar, y exige SETUP_KEY. Las dos condiciones importan: la primera
 * para que no se pueda correr dos veces, la segunda para que nadie se adelante
 * entre el deploy y el primer uso.
 */
export async function setup(req: Request, env: Env): Promise<Response> {
  const body = await cuerpo(req);

  if (!env.SETUP_KEY) {
    return error('Falta configurar SETUP_KEY. Cargala como secreto en GitHub y vuelve a publicar.', 503);
  }
  if (texto(body.setupKey, 'setupKey', { max: 200 }) !== env.SETUP_KEY) {
    return error('Clave de instalación incorrecta', 403);
  }

  const existente = await env.DB.prepare('SELECT id FROM household LIMIT 1').first();
  if (existente) return error('El hogar ya fue creado. Entra con tu email y contraseña.', 409);

  const mail = email(body.email);
  const pass = claveDerivada(body.password);
  const nombre = texto(body.displayName, 'displayName', { max: 60, min: 1 });
  const nombreHogar = texto(body.householdName ?? 'Nuestra casa', 'householdName', { max: 60, min: 1 });
  const moneda = texto(body.currency ?? 'USD', 'currency', { max: 3, min: 3 }).toUpperCase();

  const t = ahora();
  const householdId = nuevoId();
  const memberId = nuevoId();
  const { hash, salt, iterations } = await hashearPassword(pass);

  // D1 batch = una sola transaccion atomica. O entra todo o no entra nada:
  // nunca queda un hogar sin persona ni una persona sin categorias.
  const sentencias = [
    env.DB.prepare('INSERT INTO household (id, name, currency, created_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(householdId, nombreHogar, moneda, t),
    env.DB.prepare(
      `INSERT INTO member (id, household_id, email, password_hash, password_salt, iterations, display_name, color, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(memberId, householdId, mail, hash, salt, iterations, nombre, color(body.color, '#10b981'), t),
    ...sentenciasSemilla(env, householdId, t),
  ];

  await env.DB.batch(sentencias);

  const token = await crearSesion(env, memberId, req.headers.get('User-Agent'));
  return json({ ok: true, householdId }, {
    headers: { 'Set-Cookie': cookieDeSesion(token, esHttps(req)) },
  });
}

/** Categorias y jarras por defecto, en las mismas sentencias del alta. */
function sentenciasSemilla(env: Env, householdId: string, t: number) {
  const out = [];

  // La entidad Familia, y todo lo que se siembra cuelga de ella. El id es
  // deterministico igual que en la migracion 0005, para que un hogar creado
  // antes y uno creado despues se vean iguales.
  const familiaId = `${householdId}:familia`;
  out.push(
    env.DB.prepare(
      `INSERT INTO entity (id, household_id, name, kind, color, icon, display_order, archived, created_at)
       VALUES (?1, ?2, 'Familia', 'personal', '#14655a', 'house', 0, 0, ?3)`,
    ).bind(familiaId, householdId, t),
  );

  for (const [i, c] of CATEGORIAS_INICIALES.entries()) {
    out.push(
      env.DB.prepare(
        `INSERT INTO category (id, household_id, name, type, parent_id, icon, color,
                               archived, display_order, created_at, entity_id)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, 0, ?7, ?8, ?9)`,
      ).bind(nuevoId(), householdId, c.name, c.type, c.icon, c.color, i, t, familiaId),
    );
  }

  for (const [i, j] of JARRAS_INICIALES.entries()) {
    out.push(
      env.DB.prepare(
        `INSERT INTO jar (id, household_id, name, percentage_bp, color, icon,
                          display_order, acumula, created_at, entity_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      ).bind(nuevoId(), householdId, j.name, j.percentageBp, j.color, j.icon, i,
             j.acumula ? 1 : 0, t, familiaId),
    );
  }

  return out;
}

/** La persona ya dentro invita a su pareja. Tope duro de dos. */
export async function invitar(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);

  const { total } = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM member WHERE household_id = ?1',
  ).bind(sesion.householdId).first<{ total: number }>() ?? { total: 0 };

  if (total >= 2) {
    return error('El hogar ya tiene dos personas. Esta app está pensada para una pareja.', 409);
  }

  const mail = email(body.email);
  const pass = claveDerivada(body.password);
  const nombre = texto(body.displayName, 'displayName', { max: 60, min: 1 });

  const yaExiste = await env.DB.prepare('SELECT id FROM member WHERE LOWER(email) = ?1')
    .bind(mail).first();
  if (yaExiste) return error('Ese email ya está registrado', 409);

  const t = ahora();
  const memberId = nuevoId();
  const { hash, salt, iterations } = await hashearPassword(pass);

  await env.DB.prepare(
    `INSERT INTO member (id, household_id, email, password_hash, password_salt, iterations, display_name, color, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  ).bind(memberId, sesion.householdId, mail, hash, salt, iterations, nombre, color(body.color, '#6366f1'), t).run();

  const fila = await env.DB.prepare('SELECT * FROM member WHERE id = ?1').bind(memberId)
    .first<Record<string, unknown>>();

  return json({ member: fila ? aMember(fila) : null });
}

export async function login(req: Request, env: Env): Promise<Response> {
  const body = await cuerpo(req);
  const mail = email(body.email);
  const pass = typeof body.password === 'string' ? body.password : '';

  const fila = await env.DB.prepare(
    `SELECT id, password_hash, password_salt, iterations FROM member WHERE LOWER(email) = ?1`,
  ).bind(mail).first<{
    id: string; password_hash: string; password_salt: string; iterations: number;
  }>();

  // Si el email no existe igual se corre un PBKDF2 descartable. Sin esto, la
  // respuesta a un email inexistente volveria mucho mas rapido que a uno real,
  // y eso permite averiguar quien tiene cuenta.
  if (!fila) {
    await hashearPassword(pass, '00'.repeat(16));
    return error('Email o contraseña incorrectos', 401);
  }

  const ok = await verificarPassword(pass, fila.password_hash, fila.password_salt, fila.iterations);
  if (!ok) return error('Email o contraseña incorrectos', 401);

  const token = await crearSesion(env, fila.id, req.headers.get('User-Agent'));

  // Momento oportuno para barrer sesiones vencidas: no es critico y pasa poco.
  await limpiarSesiones(env).catch(() => {});

  return json({ ok: true }, { headers: { 'Set-Cookie': cookieDeSesion(token, esHttps(req)) } });
}

export async function logout(req: Request, env: Env): Promise<Response> {
  await cerrarSesion(req, env);
  return json({ ok: true }, { headers: { 'Set-Cookie': cookieVacia(esHttps(req)) } });
}

/** Cambio de contraseña. Pide la actual: una sesion robada no alcanza. */
export async function cambiarPassword(req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const body = await cuerpo(req);
  const actual = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const nueva = claveDerivada(body.newPassword);

  const fila = await env.DB.prepare(
    'SELECT password_hash, password_salt, iterations FROM member WHERE id = ?1',
  ).bind(sesion.memberId).first<{
    password_hash: string; password_salt: string; iterations: number;
  }>();
  if (!fila) return error('No encontrado', 404);

  const ok = await verificarPassword(actual, fila.password_hash, fila.password_salt, fila.iterations);
  if (!ok) return error('La contraseña actual no es correcta', 403);

  const { hash, salt, iterations } = await hashearPassword(nueva);

  await env.DB.batch([
    env.DB.prepare(
      'UPDATE member SET password_hash = ?1, password_salt = ?2, iterations = ?3 WHERE id = ?4',
    ).bind(hash, salt, iterations, sesion.memberId),
    // Se cierran las demas sesiones: si la contraseña cambio, lo que estaba
    // abierto en otro lado deja de valer.
    env.DB.prepare('DELETE FROM session WHERE member_id = ?1').bind(sesion.memberId),
  ]);

  const token = await crearSesion(env, sesion.memberId, req.headers.get('User-Agent'));
  return json({ ok: true }, { headers: { 'Set-Cookie': cookieDeSesion(token, esHttps(req)) } });
}

/** Si ya existe un hogar, la pantalla de instalacion no se muestra. */
export async function estado(_req: Request, env: Env): Promise<Response> {
  const hogar = await env.DB.prepare('SELECT id FROM household LIMIT 1').first();
  return json({ instalado: Boolean(hogar) });
}
