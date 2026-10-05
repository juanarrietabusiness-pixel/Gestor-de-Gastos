import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@shared': path.resolve(import.meta.dirname, 'shared') },
  },
  build: {
    target: 'es2022',
    // Separa lo pesado (graficos) del arranque: la app abre rapido en el celular
    // y recharts solo se descarga al entrar a Estadisticas.
    rollupOptions: {
      output: {
        manualChunks: { charts: ['recharts'] },
      },
    },
  },
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } },
  },
});
