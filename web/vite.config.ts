import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const daemon = `http://127.0.0.1:${process.env.AGENTMAP_PORT ?? 4317}`;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': daemon,
      '/ws': { target: daemon, ws: true },
    },
  },
  // O chunk da Arena (Three.js) é grande, mas só carrega quando a Arena é aberta.
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
