import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@shared': path.resolve(import.meta.dirname, 'shared') },
  },
  // El worker tambien: `barrerPapelera` borra datos sola, de noche, sin que
  // nadie la mire. Eso necesita una prueba.
  test: { environment: 'node', include: ['shared/**/*.test.ts', 'worker/**/*.test.ts'] },
});
