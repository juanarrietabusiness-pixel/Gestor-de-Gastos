/**
 * Derivacion de clave en el dispositivo.
 *
 * EL PROBLEMA
 *
 * Hashear una contraseña con la fuerza que recomienda OWASP (PBKDF2-SHA256 con
 * 210.000 iteraciones) cuesta unos 150 ms de CPU. Cloudflare Workers en plan
 * gratuito permite 10 ms por peticion, asi que el servidor no puede hacerlo:
 * lo matan a mitad de camino. Y como ese limite NO se aplica en desarrollo
 * local, el problema solo aparece en produccion.
 *
 * LA SOLUCION
 *
 * El trabajo caro lo hace el telefono, que no tiene limite de CPU:
 *
 *   dispositivo:  clave = PBKDF2(contraseña, sal = email, 210.000 vueltas)
 *   servidor:     guarda = PBKDF2(clave, sal aleatoria, 4.000 vueltas)
 *
 * Para adivinar una contraseña a partir de la base robada hay que calcular las
 * 210.000 vueltas en CADA intento, igual que antes: la fuerza no se pierde,
 * solo se mueve de lugar. Es el mismo esquema que usan Bitwarden y 1Password.
 *
 * Efecto secundario bueno: el servidor nunca recibe la contraseña real. Ni
 * siquiera un error que vuelque el cuerpo de la peticion podria filtrarla.
 *
 * POR QUE EL EMAIL COMO SAL
 *
 * La sal tiene que ser deterministica para que el dispositivo pueda derivar la
 * clave sin preguntarle nada al servidor primero. El email cumple: es unico
 * por persona y se conoce antes de entrar. Va con un prefijo de version para
 * poder cambiar el esquema mas adelante sin romper lo que ya existe.
 */

const ITERACIONES_CLIENTE = 210_000;
const VERSION_SAL = 'gg:v1:';

const enc = new TextEncoder();

const aHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Convierte una contraseña en la clave que viaja al servidor.
 *
 * El email se normaliza igual que en el servidor (recortado y en minusculas):
 * si difirieran, la clave derivada no coincidiria y no se podria entrar.
 */
export async function derivarClave(password: string, email: string): Promise<string> {
  const sal = enc.encode(VERSION_SAL + email.trim().toLowerCase());

  const material = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: ITERACIONES_CLIENTE },
    material,
    256,
  );

  return aHex(bits);
}

/** Longitud minima de la contraseña de verdad, la que escribe la persona. */
export const MIN_PASSWORD = 8;

/**
 * Forma que tiene que tener la clave derivada: 64 caracteres hexadecimales
 * (256 bits). El servidor lo valida asi, porque despues de derivar ya no puede
 * saber cuan larga era la contraseña original.
 */
export const ES_CLAVE_DERIVADA = /^[0-9a-f]{64}$/;
