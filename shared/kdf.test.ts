import { describe, expect, it } from 'vitest';
import { derivarClave, ES_CLAVE_DERIVADA } from './kdf.ts';

describe('derivarClave', () => {
  it('devuelve 64 caracteres hexadecimales', async () => {
    const clave = await derivarClave('contrasena-larga', 'ana@test.com');
    expect(clave).toMatch(ES_CLAVE_DERIVADA);
  });

  it('es deterministica: la misma entrada da la misma clave', async () => {
    const a = await derivarClave('contrasena-larga', 'ana@test.com');
    const b = await derivarClave('contrasena-larga', 'ana@test.com');
    expect(a).toBe(b);
  });

  it('normaliza el email igual que el servidor', async () => {
    // El servidor guarda el email en minusculas. Si el cliente derivara con
    // otra capitalizacion, la clave no coincidiria y no se podria entrar.
    const a = await derivarClave('contrasena-larga', 'Ana@Test.COM');
    const b = await derivarClave('contrasena-larga', '  ana@test.com  ');
    expect(a).toBe(b);
  });

  it('dos personas con la misma contraseña obtienen claves distintas', async () => {
    // Esto es lo que aporta la sal: sin ella, ver dos hashes iguales en la
    // base revelaria que comparten contraseña.
    const ana = await derivarClave('la-misma-clave', 'ana@test.com');
    const beto = await derivarClave('la-misma-clave', 'beto@test.com');
    expect(ana).not.toBe(beto);
  });

  it('contraseñas distintas dan claves distintas', async () => {
    const a = await derivarClave('contrasena-uno', 'ana@test.com');
    const b = await derivarClave('contrasena-dos', 'ana@test.com');
    expect(a).not.toBe(b);
  });

  it('no deja rastro de la contraseña en la salida', async () => {
    const clave = await derivarClave('mi-contrasena-secreta', 'ana@test.com');
    expect(clave).not.toContain('secreta');
    expect(clave).not.toContain('contrasena');
  });
});
